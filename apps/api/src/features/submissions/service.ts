import { build270, submitterIssues } from '@ugula/billing';
import {
  allocateControlNumber,
  type Db,
  eligibilityRequests,
  findEligibilityClaim,
  findProfile,
  findPublishedGraphs,
  NO_CHECKABLE_PAYER,
  startRun,
  toSubmitter
} from '@ugula/db';
import type { RunQueueClient } from '@ugula/run-queue';
import type { BlobRef, BlobStore } from '@ugula/storage';
import { fail, ok } from '../../shared/result.ts';
import { findBatchDocument } from './queries.ts';

type SubmissionServiceDeps = {
  db: Db;
  boss: RunQueueClient;
  now: () => Date;
  blobs: Pick<BlobStore, 'getBytes'>;
};

const CHECK_ELIGIBILITY_WORKFLOW = { key: 'billing.check-eligibility', version: 1 };

export const createSubmissionService = ({ db, boss, now, blobs }: SubmissionServiceDeps) => ({
  document: async (agencyId: string, id: string) => {
    const found = await findBatchDocument(db, agencyId, id);
    if (!found) return fail('not_found', 'Batch not found');
    const ref = found.document as BlobRef;
    return ok({
      bytes: await blobs.getBytes(ref),
      contentType: ref.contentType,
      name: ref.key.split('/').at(-1) ?? 'batch.txt'
    });
  },

  eligibility: async (agencyId: string, claimId: string) => {
    const [profile, row] = await Promise.all([
      findProfile(db, agencyId),
      findEligibilityClaim(db, agencyId, claimId)
    ]);
    if (!row) return fail('not_found', 'Claim not found');
    const submitter = profile ? toSubmitter(profile) : null;
    const problems = submitterIssues(submitter);
    if (!submitter || problems.length) {
      return fail('invalid', problems[0] ?? 'Add a billing profile in Settings', {
        issues: problems
      });
    }
    const requests = eligibilityRequests(row, now());
    if (!requests.length) return fail('invalid', NO_CHECKABLE_PAYER);
    const controlNumber = await allocateControlNumber(db, agencyId);
    if (controlNumber === null) {
      return fail('conflict', 'Batch control numbers are used up; contact support');
    }
    return ok({
      name: `eligibility-${row.number}-${controlNumber}.x12`,
      file: build270(submitter, requests, { controlNumber, createdAt: now() }),
      payers: requests.map((r) => r.payer.name)
    });
  },

  checkEligibility: (agencyId: string, claimId: string) =>
    db.transaction().execute(async (tx) => {
      const row = await findEligibilityClaim(tx, agencyId, claimId);
      if (!row) return fail('not_found', 'Claim not found');
      if (!eligibilityRequests(row, now()).length) {
        return fail('invalid', NO_CHECKABLE_PAYER);
      }
      const [version] = await findPublishedGraphs(tx, agencyId, [CHECK_ELIGIBILITY_WORKFLOW]);
      if (!version) return fail('not_found', 'The check eligibility workflow is not published');
      const runId = await startRun(tx, boss, {
        agencyId,
        versionId: version.id,
        inputs: { claimId },
        interactive: true
      });
      return ok({ runId });
    })
});

export type SubmissionService = ReturnType<typeof createSubmissionService>;
