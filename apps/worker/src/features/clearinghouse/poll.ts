import type { Clearinghouse, ClearinghouseFile } from '@ugula/billing';
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
};

export const receiverOf = (text: string) => {
  const start = text.indexOf('ISA');
  if (start < 0 || text.length < start + ISA_LENGTH) return null;
  const isa = text.slice(start, start + ISA_LENGTH).split(text.charAt(start + 3));
  return isa[8]?.trim() || null;
};

const fileKey = (path: string, size: number, modifiedAt: Date) =>
  `${path}\u0000${size}\u0000${modifiedAt.getTime()}`;

const unseen = async (db: Db, source: string, files: ClearinghouseFile[]) => {
  if (!files.length) return [];
  const rows = await db
    .selectFrom('clearinghouse_downloads')
    .select(['remote_path', 'size', 'modified_at'])
    .where('source', '=', source)
    .where(
      'remote_path',
      'in',
      files.map((f) => f.path)
    )
    .execute();
  const seen = new Set(rows.map((r) => fileKey(r.remote_path, r.size, r.modified_at)));
  return files.filter((f) => !seen.has(fileKey(f.path, f.size, f.modifiedAt)));
};

const agenciesReceiving = async (db: Db, receiver: string | null) =>
  receiver
    ? (
        await db
          .selectFrom('billing_profiles')
          .select('agency_id')
          .where('submitter_id', '=', receiver)
          .execute()
      ).map((r) => r.agency_id)
    : [];

const receive = async (
  deps: PollDeps,
  source: string,
  clearinghouse: Clearinghouse,
  f: ClearinghouseFile
) => {
  const { db, boss, blobs } = deps;
  const bytes = await clearinghouse.download(f.path);
  const receiver = receiverOf(new TextDecoder().decode(bytes));
  const agencies = await agenciesReceiving(db, receiver);
  const [agencyId] = agencies;
  const version =
    agencies.length === 1 && agencyId
      ? await resolveWorkflowVersion(db, agencyId, RECEIVE_WORKFLOW)
      : undefined;
  const note = !receiver
    ? 'Not an X12 file'
    : agencies.length !== 1
      ? `${agencies.length ? 'More than one agency has' : 'No agency has'} submitter ID ${receiver}`
      : version
        ? ''
        : `The ${RECEIVE_WORKFLOW} workflow is not published`;
  const document =
    version && agencyId
      ? await blobs.putBytes(
          `clearinghouse/${agencyId}/${f.modifiedAt.getTime()}-${f.name}`,
          bytes,
          'application/edi-x12'
        )
      : null;
  const runId = await db.transaction().execute(async (tx) => {
    const id =
      version && agencyId && document
        ? await startRun(tx, boss, {
            agencyId,
            versionId: version.id,
            inputs: { file: document, fileName: f.name }
          })
        : null;
    await tx
      .insertInto('clearinghouse_downloads')
      .values({
        source,
        remote_path: f.path,
        size: f.size,
        modified_at: f.modifiedAt,
        agency_id: agencies.length === 1 ? (agencyId ?? null) : null,
        run_id: id,
        note
      })
      .execute();
    return id;
  });
  if (runId && clearinghouse.afterDownload === 'delete') await clearinghouse.remove(f.path);
  deps.report(
    runId
      ? `Clearinghouse: received ${f.path}, run ${runId}`
      : `Clearinghouse: left ${f.path} on the server: ${note}`
  );
};

const pollTarget = async (deps: PollDeps, { source, clearinghouse }: PollTarget) => {
  for (const f of await unseen(deps.db, source, await clearinghouse.pollResponses())) {
    await receive(deps, source, clearinghouse, f).catch((err: unknown) =>
      deps.report(`Clearinghouse: could not receive ${f.path}: ${String(err)}`)
    );
  }
};

export const createClearinghousePoll = (deps: PollDeps) => async () => {
  for (const target of await deps.targets()) {
    await pollTarget(deps, target).catch((err: unknown) =>
      deps.report(`Clearinghouse: could not poll ${target.source}: ${String(err)}`)
    );
  }
};
