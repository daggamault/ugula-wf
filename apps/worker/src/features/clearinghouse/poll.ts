import { createHash } from 'node:crypto';
import type { ClearinghouseFile, ClearinghouseInbox } from '@ugula/billing';
import { type Db, resolveWorkflowVersion, startRun } from '@ugula/db';
import type { RunQueueClient } from '@ugula/run-queue';
import type { BlobStore } from '@ugula/storage';
import type { PollTarget } from '../../shared/clearinghouse.ts';

const RECEIVE_WORKFLOW = 'billing.receive-payer-file';

const ISA_LENGTH = 106;

type PollDeps = {
  db: Db;
  boss: RunQueueClient;
  blobs: Pick<BlobStore, 'putBytes'>;
  targets: () => Promise<PollTarget[]>;
  report: (message: string) => void;
  now?: () => Date;
};

const RETRY_MS = 60 * 60 * 1000;

type Pending = { file: ClearinghouseFile; note: string | null };

export const receiverOf = (text: string) => {
  const start = text.indexOf('ISA');
  if (start < 0 || text.length < start + ISA_LENGTH) return null;
  const isa = text.slice(start, start + ISA_LENGTH).split(text.charAt(start + 3));
  return isa[8]?.trim() || null;
};

const fileKey = (path: string, size: number, modifiedAt: Date) =>
  `${path}\u0000${size}\u0000${modifiedAt.getTime()}`;

const pending = async (
  db: Db,
  source: string,
  files: ClearinghouseFile[],
  at: Date
): Promise<Pending[]> => {
  if (!files.length) return [];
  const rows = await db
    .selectFrom('clearinghouse_downloads')
    .select(['remote_path', 'size', 'modified_at', 'run_id', 'note', 'tried_at'])
    .where('source', '=', source)
    .where(
      'remote_path',
      'in',
      files.map((f) => f.path)
    )
    .execute();
  const seen = new Map(rows.map((r) => [fileKey(r.remote_path, r.size, r.modified_at), r]));
  return files.flatMap((file) => {
    const row = seen.get(fileKey(file.path, file.size, file.modifiedAt));
    if (row?.run_id) return [];
    if (row?.note && at.getTime() - row.tried_at.getTime() < RETRY_MS) return [];
    return [{ file, note: row?.note ?? null }];
  });
};

const storageKey = (agencyId: string, f: ClearinghouseFile) =>
  `clearinghouse/${agencyId}/${f.modifiedAt.getTime()}-${createHash('sha256').update(f.path).digest('hex').slice(0, 8)}-${f.name}`;

const agenciesReceiving = async (db: Db, receiver: string | null, owners: string[] | null) =>
  receiver && owners?.length !== 0
    ? (
        await db
          .selectFrom('billing_profiles')
          .select('agency_id')
          .where('submitter_id', '=', receiver)
          .$if(owners !== null, (qb) => qb.where('agency_id', 'in', owners ?? []))
          .execute()
      ).map((r) => r.agency_id)
    : [];

const noteOf = (
  receiver: string | null,
  agencies: string[],
  owned: boolean,
  published: boolean
) => {
  if (!receiver) return 'Not an X12 file';
  if (agencies.length > 1) return `More than one agency has submitter ID ${receiver}`;
  if (!agencies.length) {
    return `No agency ${owned ? 'using this connection ' : ''}has submitter ID ${receiver}`;
  }
  return published ? '' : `The ${RECEIVE_WORKFLOW} workflow is not published`;
};

const receive = async (
  deps: PollDeps,
  { source, clearinghouse, agencyIds }: PollTarget,
  inbox: ClearinghouseInbox,
  { file: f, note: previous }: Pending,
  at: Date
) => {
  const { db, boss, blobs } = deps;
  const bytes = await inbox.download(f.path);
  const receiver = receiverOf(new TextDecoder().decode(bytes));
  const agencies = await agenciesReceiving(db, receiver, agencyIds);
  const agencyId = agencies.length === 1 ? (agencies[0] ?? null) : null;
  const version = agencyId ? await resolveWorkflowVersion(db, agencyId, RECEIVE_WORKFLOW) : null;
  const note = noteOf(receiver, agencies, agencyIds !== null, Boolean(version));
  const document =
    version && agencyId
      ? await blobs.putBytes(storageKey(agencyId, f), bytes, 'application/edi-x12')
      : null;
  const runId = await db.transaction().execute(async (tx) => {
    const claimed = await tx
      .insertInto('clearinghouse_downloads')
      .values({
        source,
        remote_path: f.path,
        size: f.size,
        modified_at: f.modifiedAt,
        agency_id: agencyId,
        note,
        tried_at: at
      })
      .onConflict((oc) =>
        oc
          .constraint('clearinghouse_downloads_file_unique')
          .doUpdateSet((eb) => ({
            agency_id: eb.ref('excluded.agency_id'),
            note: eb.ref('excluded.note'),
            tried_at: eb.ref('excluded.tried_at')
          }))
          .where('clearinghouse_downloads.run_id', 'is', null)
      )
      .returning('id')
      .executeTakeFirst();
    if (!claimed || !version || !agencyId || !document) return null;
    const id = await startRun(tx, boss, {
      agencyId,
      versionId: version.id,
      inputs: { file: document, fileName: f.name }
    });
    await tx
      .updateTable('clearinghouse_downloads')
      .set({ run_id: id })
      .where('id', '=', claimed.id)
      .execute();
    return id;
  });
  if (runId) {
    if (clearinghouse.afterDownload === 'delete') await inbox.remove(f.path);
    deps.report(`Clearinghouse: received ${f.path}, run ${runId}`);
  } else if (note && note !== previous) {
    deps.report(`Clearinghouse: left ${f.path} on the server: ${note}`);
  }
};

const pollTarget = (deps: PollDeps, target: PollTarget) =>
  target.clearinghouse.inbox(async (inbox) => {
    const at = (deps.now ?? (() => new Date()))();
    for (const p of await pending(deps.db, target.source, await inbox.list(), at)) {
      await receive(deps, target, inbox, p, at).catch((err: unknown) =>
        deps.report(`Clearinghouse: could not receive ${p.file.path}: ${String(err)}`)
      );
    }
  });

export const createClearinghousePoll = (deps: PollDeps) => async () => {
  for (const target of await deps.targets()) {
    await pollTarget(deps, target).catch((err: unknown) =>
      deps.report(`Clearinghouse: could not poll ${target.source}: ${String(err)}`)
    );
  }
};
