import {
  type Clearinghouse,
  type ClearinghouseSettings,
  createClearinghouse,
  type RealtimeTransport
} from '@ugula/billing';
import {
  createCoreRealtime,
  createSftpBatch,
  openSecret,
  type SecretKey
} from '@ugula/clearinghouse';
import type { Db } from '@ugula/db';

export type ConnectionSettings = ClearinghouseSettings & { username: string; password: string };

export type PollTarget = { source: string; clearinghouse: Clearinghouse };

type ConnectionDeps = {
  db: Db;
  key: SecretKey | null;
  fallback: ConnectionSettings | null;
  fetch: typeof fetch;
  realtimeTimeoutMs: number;
  report: (message: string) => void;
};

const REALTIME_RECEIVER = 'WAYSTAR';

export const sourceOf = (c: ConnectionSettings) =>
  `sftp://${c.username}@${c.host}:${c.port}${c.downloadPaths.join(',')}`;

export const connect = (
  c: ConnectionSettings,
  realtime: { senderId: string | null; fetch: typeof fetch; timeoutMs: number }
): Clearinghouse => {
  const send: RealtimeTransport | null =
    c.realtimeUrl && realtime.senderId
      ? createCoreRealtime({
          url: c.realtimeUrl,
          username: c.username,
          password: c.password,
          senderId: realtime.senderId,
          receiverId: REALTIME_RECEIVER,
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
      'cc.sftp_host',
      'cc.sftp_port',
      'cc.sftp_username',
      'cc.sftp_secret',
      'cc.upload_path',
      'cc.download_paths',
      'cc.claim_extension',
      'cc.eligibility_extension',
      'cc.claim_status_extension',
      'cc.after_download',
      'cc.realtime_url',
      'b.submitter_id'
    ])
    .where('cc.enabled', '=', true);

type ConnectionRow = Awaited<ReturnType<ReturnType<typeof connectionRows>['execute']>>[number];

export const createConnections = (deps: ConnectionDeps) => {
  const settingsOf = (r: ConnectionRow): ConnectionSettings | null => {
    if (!deps.key) {
      deps.report(
        `Clearinghouse: agency ${r.agency_id} has a connection, but CLEARINGHOUSE_SECRET_KEY is not set`
      );
      return null;
    }
    try {
      return {
        host: r.sftp_host,
        port: r.sftp_port,
        username: r.sftp_username,
        password: openSecret(deps.key, r.sftp_secret, r.agency_id),
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
  const realtime = (senderId: string | null) => ({
    senderId,
    fetch: deps.fetch,
    timeoutMs: deps.realtimeTimeoutMs
  });
  const submitterOf = async (agencyId: string) =>
    (
      await deps.db
        .selectFrom('billing_profiles')
        .select('submitter_id')
        .where('agency_id', '=', agencyId)
        .executeTakeFirst()
    )?.submitter_id ?? null;
  return {
    forAgency: async (agencyId: string): Promise<Clearinghouse | null> => {
      const row = await connectionRows(deps.db)
        .where('cc.agency_id', '=', agencyId)
        .executeTakeFirst();
      if (row) {
        const settings = settingsOf(row);
        return settings ? connect(settings, realtime(row.submitter_id)) : null;
      }
      return deps.fallback ? connect(deps.fallback, realtime(await submitterOf(agencyId))) : null;
    },
    pollTargets: async (): Promise<PollTarget[]> => {
      const settings = [
        ...(deps.fallback ? [deps.fallback] : []),
        ...(await connectionRows(deps.db).execute()).flatMap((r) => settingsOf(r) ?? [])
      ];
      const unique = new Map(settings.map((s) => [sourceOf(s), s]));
      return [...unique].map(([source, s]) => ({
        source,
        clearinghouse: connect(s, realtime(null))
      }));
    }
  };
};

export type Connections = ReturnType<typeof createConnections>;
