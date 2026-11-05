import {
  type Clearinghouse,
  type ClearinghouseSettings,
  createClearinghouse,
  type RealtimeTransport
} from '@ugula/billing';
import {
  createCoreRealtime,
  createSftpBatch,
  needsReseal,
  openSecret,
  type SecretKeyring,
  sealSecret
} from '@ugula/clearinghouse';
import type { Db } from '@ugula/db';

export type ConnectionSettings = ClearinghouseSettings & { username: string; password: string };

export type PollTarget = {
  source: string;
  clearinghouse: Clearinghouse;
  agencyIds: string[] | null;
};

type ConnectionDeps = {
  db: Db;
  keyring: SecretKeyring | null;
  fallback: ConnectionSettings | null;
  fetch: typeof fetch;
  realtimeTimeoutMs: number;
  report: (message: string) => void;
};

type Parties = { senderId: string | null; receiverId: string | null };

type Realtime = Parties & { fetch: typeof fetch; timeoutMs: number };

const NO_PARTIES: Parties = { senderId: null, receiverId: null };

export const sourceOf = (c: ConnectionSettings) =>
  `sftp://${c.username}@${c.host}:${c.port}${c.downloadPaths.join(',')}`;

export const connect = (c: ConnectionSettings, realtime: Realtime): Clearinghouse => {
  const send: RealtimeTransport | null =
    c.realtimeUrl && realtime.senderId && realtime.receiverId
      ? createCoreRealtime({
          url: c.realtimeUrl,
          username: c.username,
          password: c.password,
          senderId: realtime.senderId,
          receiverId: realtime.receiverId,
          timeoutMs: realtime.timeoutMs,
          fetch: realtime.fetch
        })
      : null;
  return createClearinghouse({
    batch: createSftpBatch({
      host: c.host,
      port: c.port,
      username: c.username,
      password: c.password,
      hostKey: c.hostKey,
      uploadPath: c.uploadPath,
      downloadPaths: c.downloadPaths
    }),
    realtime: send,
    extensions: c.extensions,
    afterDownload: c.afterDownload
  });
};

const connectionRows = (db: Db) =>
  db
    .selectFrom('clearinghouse_connections as cc')
    .leftJoin('billing_profiles as b', 'b.agency_id', 'cc.agency_id')
    .select([
      'cc.agency_id',
      'cc.enabled',
      'cc.sftp_host',
      'cc.sftp_port',
      'cc.sftp_host_key',
      'cc.sftp_username',
      'cc.sftp_secret',
      'cc.upload_path',
      'cc.download_paths',
      'cc.claim_extension',
      'cc.eligibility_extension',
      'cc.claim_status_extension',
      'cc.after_download',
      'cc.realtime_url',
      'b.submitter_id',
      'b.receiver_id'
    ]);

type ConnectionRow = Awaited<ReturnType<ReturnType<typeof connectionRows>['execute']>>[number];

export const createConnections = (deps: ConnectionDeps) => {
  const settingsOf = (r: ConnectionRow): ConnectionSettings | null => {
    if (!deps.keyring) {
      deps.report(
        `Clearinghouse: agency ${r.agency_id} has a connection, but CLEARINGHOUSE_SECRET_KEY is not set`
      );
      return null;
    }
    try {
      return {
        host: r.sftp_host,
        port: r.sftp_port,
        hostKey: r.sftp_host_key,
        username: r.sftp_username,
        password: openSecret(deps.keyring, r.sftp_secret, r.agency_id),
        uploadPath: r.upload_path,
        downloadPaths: r.download_paths,
        extensions: {
          claims: r.claim_extension,
          eligibility: r.eligibility_extension,
          claimStatus: r.claim_status_extension
        },
        afterDownload: r.after_download,
        realtimeUrl: r.realtime_url
      };
    } catch {
      deps.report(`Clearinghouse: the password of agency ${r.agency_id} cannot be opened`);
      return null;
    }
  };
  const reseal = async (ring: SecretKeyring, r: ConnectionRow) => {
    try {
      const plain = openSecret(ring, r.sftp_secret, r.agency_id);
      await deps.db
        .updateTable('clearinghouse_connections')
        .set({ sftp_secret: sealSecret(ring, plain, r.agency_id) })
        .where('agency_id', '=', r.agency_id)
        .where('sftp_secret', '=', r.sftp_secret)
        .execute();
      deps.report(
        `Clearinghouse: sealed the password of agency ${r.agency_id} with the current key`
      );
    } catch {
      deps.report(`Clearinghouse: the password of agency ${r.agency_id} cannot be opened`);
    }
  };
  const realtime = (parties: Parties): Realtime => ({
    ...parties,
    fetch: deps.fetch,
    timeoutMs: deps.realtimeTimeoutMs
  });
  const partiesOf = async (agencyId: string): Promise<Parties> => {
    const profile = await deps.db
      .selectFrom('billing_profiles')
      .select(['submitter_id', 'receiver_id'])
      .where('agency_id', '=', agencyId)
      .executeTakeFirst();
    return { senderId: profile?.submitter_id ?? null, receiverId: profile?.receiver_id ?? null };
  };
  return {
    forAgency: async (agencyId: string): Promise<Clearinghouse | null> => {
      const row = await connectionRows(deps.db)
        .where('cc.agency_id', '=', agencyId)
        .executeTakeFirst();
      if (row) {
        const settings = row.enabled ? settingsOf(row) : null;
        return settings
          ? connect(settings, realtime({ senderId: row.submitter_id, receiverId: row.receiver_id }))
          : null;
      }
      return deps.fallback ? connect(deps.fallback, realtime(await partiesOf(agencyId))) : null;
    },
    pollTargets: async (): Promise<PollTarget[]> => {
      const rows = await connectionRows(deps.db).execute();
      const { keyring } = deps;
      if (keyring) {
        for (const r of rows) if (needsReseal(keyring, r.sftp_secret)) await reseal(keyring, r);
      }
      const targets = new Map<
        string,
        { settings: ConnectionSettings; agencyIds: string[] | null }
      >();
      if (deps.fallback) {
        targets.set(sourceOf(deps.fallback), { settings: deps.fallback, agencyIds: null });
      }
      for (const r of rows) {
        const settings = r.enabled ? settingsOf(r) : null;
        if (!settings) continue;
        const source = sourceOf(settings);
        const known = targets.get(source);
        if (!known) targets.set(source, { settings, agencyIds: [r.agency_id] });
        else known.agencyIds?.push(r.agency_id);
      }
      return [...targets].map(([source, { settings, agencyIds }]) => ({
        source,
        clearinghouse: connect(settings, realtime(NO_PARTIES)),
        agencyIds
      }));
    }
  };
};

export type Connections = ReturnType<typeof createConnections>;
