import { build270, type EligibilityRequest, SELF, submitterIssues } from '@ugula/billing';
import { allocateControlNumber, type Db, findProfile, toSubmitter } from '@ugula/db';
import type { BlobRef, BlobStore } from '@ugula/storage';
import { fail, ok } from '../../shared/result.ts';
import { type EligibilityClaimRow, findBatchDocument, findEligibilityClaim } from './queries.ts';

type SubmissionServiceDeps = {
  db: Db;
  now: () => Date;
  blobs: Pick<BlobStore, 'getBytes'>;
};

export const eligibilityRequests = (
  row: EligibilityClaimRow,
  today: string
): EligibilityRequest[] =>
  row.coverages.flatMap((c) => {
    if (!c.payer_id || !c.member_id) return [];
    const self = c.relationship === SELF;
    const lastName = self ? row.last_name : c.insured_last_name;
    if (!lastName) return [];
    return [
      {
        trace: c.id,
        payer: { name: c.payer, payerId: c.payer_id },
        subscriber: {
          lastName,
          firstName: self ? row.first_name : c.insured_first_name,
          memberId: c.member_id,
          birthDate: self ? row.birth_date : null,
          sex: self ? row.gender : null
        },
        serviceDate: row.service_date ?? today
      }
    ];
  });

export const createSubmissionService = ({ db, now, blobs }: SubmissionServiceDeps) => ({
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
    const requests = eligibilityRequests(row, now().toISOString().slice(0, 10));
    if (!requests.length) {
      return fail(
        'invalid',
        'No payer on this claim has a directory payer and member ID to check eligibility with'
      );
    }
    const controlNumber = await allocateControlNumber(db, agencyId);
    if (controlNumber === null) {
      return fail('conflict', 'Batch control numbers are used up; contact support');
    }
    return ok({
      name: `eligibility-${row.number}-${controlNumber}.x12`,
      file: build270(submitter, requests, { controlNumber, createdAt: now() }),
      payers: requests.map((r) => r.payer.name)
    });
  }
});

export type SubmissionService = ReturnType<typeof createSubmissionService>;
