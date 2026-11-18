import { posix } from 'node:path';
import {
  build837,
  type ClaimStatus,
  currentPayerIndex,
  isBillable,
  isSelfPay,
  type SentClaim,
  x837ClaimOf
} from '@ugula/billing';
import { openSecret, type SecretKeyring, type SftpAccount, uploadFile } from '@ugula/clearinghouse';
import { checkClaim, type Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';

type Upload = typeof uploadFile;

type SenderDeps = {
  db: Kysely<Database>;
  keyring: SecretKeyring | null;
  upload?: Upload;
  now: () => Date;
};

type Submission = {
  id: string;
  revision: number;
  coverage_position: number;
  control_number: number;
  file_name: string;
  content: string;
};

type Prepared = SentClaim | { outcome: 'upload'; submission: Submission };

const NO_CONNECTION =
  'The agency has no active clearinghouse connection: set one up in Settings, then retry this run';

const SUBMISSION_COLUMNS = [
  'id',
  'revision',
  'coverage_position',
  'control_number',
  'file_name',
  'content'
] as const;

const SENDABLE: readonly ClaimStatus[] = ['approved', 'submitted', 'rejected'];

export const fileNameOf = (submitterId: string, controlNumber: number, extension: string) =>
  `${submitterId.replace(/[^A-Za-z0-9]/g, '').slice(0, 15)}${String(controlNumber).padStart(9, '0')}${extension}`;

const findConnection = (db: Kysely<Database>, agencyId: string) =>
  db
    .selectFrom('clearinghouse_connections')
    .select([
      'sftp_host',
      'sftp_port',
      'sftp_host_key',
      'sftp_username',
      'sftp_secret',
      'upload_path',
      'claim_extension'
    ])
    .where('agency_id', '=', agencyId)
    .where('is_active', '=', true)
    .executeTakeFirst();

export const createClaimSender =
  ({ db, keyring, upload = uploadFile, now }: SenderDeps) =>
  async (runId: string, claimId: string): Promise<SentClaim> => {
    if (!isUuid(claimId)) throw new Error(`Claim ${claimId} does not exist`);
    const agencyId = (await runAgency(db, runId).executeTakeFirst())?.agency_id;
    if (!agencyId) throw new Error(`Run ${runId} does not exist`);
    const prepared = await db.transaction().execute(async (tx): Promise<Prepared> => {
      const locked = await tx
        .selectFrom('claims')
        .select(['status', 'revision'])
        .where('agency_id', '=', agencyId)
        .where('id', '=', claimId)
        .forUpdate()
        .executeTakeFirst();
      if (!locked) throw new Error(`Claim ${claimId} does not exist`);
      if (!SENDABLE.includes(locked.status)) return { outcome: 'nothingToSend' };
      const check = await checkClaim(tx, agencyId, claimId);
      if (!check) throw new Error(`Claim ${claimId} does not exist`);
      if (isSelfPay(check.claim)) return { outcome: 'selfPay' };
      const current = currentPayerIndex(check.claim.coverages);
      const payer = check.claim.coverages[current];
      if (!payer || !isBillable(payer.status)) return { outcome: 'nothingToSend' };
      const reserved = await tx
        .selectFrom('claim_submissions')
        .select(SUBMISSION_COLUMNS)
        .where('claim_id', '=', claimId)
        .where('revision', '=', locked.revision)
        .where('coverage_position', '=', current + 1)
        .where('sent_at', 'is', null)
        .executeTakeFirst();
      if (reserved) return { outcome: 'upload', submission: reserved };
      if (check.issues.length || !check.submitter?.submitterId) {
        return { outcome: 'notReady', issues: check.issues };
      }
      const connection = await findConnection(tx, agencyId);
      if (!connection) throw new Error(NO_CONNECTION);
      await sql`select pg_advisory_xact_lock(hashtext(${agencyId}))`.execute(tx);
      const { next } = await tx
        .selectFrom('claim_submissions')
        .select(sql<number>`coalesce(max(control_number), 0) + 1`.as('next'))
        .where('agency_id', '=', agencyId)
        .executeTakeFirstOrThrow();
      const controlNumber = Number(next);
      const submission = await tx
        .insertInto('claim_submissions')
        .values({
          agency_id: agencyId,
          claim_id: claimId,
          revision: locked.revision,
          coverage_position: current + 1,
          control_number: controlNumber,
          file_name: fileNameOf(
            check.submitter.submitterId,
            controlNumber,
            connection.claim_extension
          ),
          content: build837(check.submitter, [x837ClaimOf(check.claim)], {
            controlNumber,
            createdAt: now()
          })
        })
        .returning(SUBMISSION_COLUMNS)
        .executeTakeFirstOrThrow();
      return { outcome: 'upload', submission };
    });
    if (prepared.outcome !== 'upload') return prepared;
    const { submission } = prepared;
    const connection = await findConnection(db, agencyId);
    if (!connection) throw new Error(NO_CONNECTION);
    if (!keyring) {
      throw new Error('The worker has no CLEARINGHOUSE_SECRET_KEY to open the SFTP password with');
    }
    const account: SftpAccount = {
      host: connection.sftp_host,
      port: connection.sftp_port,
      hostKey: connection.sftp_host_key,
      username: connection.sftp_username,
      password: openSecret(keyring, connection.sftp_secret, agencyId)
    };
    await upload(
      account,
      posix.join(connection.upload_path, submission.file_name),
      submission.content
    );
    await db.transaction().execute(async (tx) => {
      await tx
        .updateTable('claim_submissions')
        .set({ sent_at: sql`now()` })
        .where('id', '=', submission.id)
        .execute();
      await tx
        .updateTable('claim_coverages')
        .set({ status: 'sent', status_note: null, updated_at: sql`now()` })
        .where('claim_id', '=', claimId)
        .where('position', '=', submission.coverage_position)
        .execute();
      await tx
        .updateTable('claims')
        .set({ status: 'submitted', updated_at: sql`now()` })
        .where('agency_id', '=', agencyId)
        .where('id', '=', claimId)
        .where('revision', '=', submission.revision)
        .where('status', 'in', SENDABLE)
        .execute();
    });
    return {
      outcome: 'sent',
      fileName: submission.file_name,
      controlNumber: submission.control_number
    };
  };
