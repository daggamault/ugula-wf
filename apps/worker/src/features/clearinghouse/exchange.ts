import { randomUUID } from 'node:crypto';
import {
  build270,
  build276,
  type ClaimStatusInquiry,
  type Clearinghouse,
  claimSignalKey,
  claimStatusNote,
  type ExchangeStore,
  exchangeFileName,
  localDate,
  readClaimStatus,
  SELF,
  type Submitter,
  submitterIssues
} from '@ugula/billing';
import {
  agencyTimeZone,
  allocateControlNumber,
  type Db,
  eligibilityRequests,
  findEligibilityClaim,
  findProfile,
  NO_CHECKABLE_PAYER,
  toSubmitter
} from '@ugula/db';
import type { BlobStore } from '@ugula/storage';
import { sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';
import type { ApplyDocument } from './payer-files.ts';

type ExchangeDeps = {
  db: Db;
  blobs: Pick<BlobStore, 'putBytes'>;
  applyDocument: ApplyDocument;
  clearinghouseFor: (agencyId: string) => Promise<Clearinghouse | null>;
  now?: () => Date;
};

const NO_CONNECTION =
  'The agency has no clearinghouse connection, or it is paused; set one up in Settings or download the request from the claim';

const SUBMISSIONS = ['submitted', 'resubmitted'] as const;

const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason });

const bytesOf = (text: string) => new TextEncoder().encode(text);

const statusClaim = (db: Db, agencyId: string, claimId: string, coverageId: string) =>
  db
    .selectFrom('claims as c')
    .innerJoin('patients as p', 'p.id', 'c.patient_id')
    .innerJoin('claim_coverages as cc', 'cc.claim_id', 'c.id')
    .innerJoin('payers as dp', 'dp.id', 'cc.payer_id')
    .select((eb) => [
      'c.number',
      'c.total_cents',
      'c.service_date',
      'p.first_name',
      'p.last_name',
      'p.birth_date',
      'p.gender',
      'cc.member_id',
      'cc.relationship',
      'cc.insured_first_name',
      'cc.insured_last_name',
      'dp.name as payer',
      'dp.payer_id',
      agencyTimeZone(sql.ref('c.agency_id')).as('time_zone'),
      eb
        .selectFrom('claim_events as e')
        .select('e.payer_claim_number')
        .whereRef('e.coverage_id', '=', 'cc.id')
        .where('e.payer_claim_number', 'is not', null)
        .orderBy('e.created_at', 'desc')
        .limit(1)
        .as('payer_claim_number'),
      eb
        .exists(
          eb
            .selectFrom('claim_events as s')
            .select('s.id')
            .whereRef('s.coverage_id', '=', 'cc.id')
            .where('s.kind', 'in', SUBMISSIONS)
        )
        .as('submitted'),
      eb
        .selectFrom('signals as g')
        .select('g.received')
        .whereRef('g.agency_id', '=', 'c.agency_id')
        .where('g.key', '=', claimSignalKey(claimId))
        .as('received')
    ])
    .where('c.agency_id', '=', agencyId)
    .where('c.id', '=', isUuid(claimId) ? claimId : null)
    .where('cc.id', '=', isUuid(coverageId) ? coverageId : null)
    .executeTakeFirst();

const statusFor = (text: string, claimNumber: string) => {
  try {
    return readClaimStatus(text).find((s) => s.claimNumber === claimNumber);
  } catch {
    return undefined;
  }
};

type StatusRow = NonNullable<Awaited<ReturnType<typeof statusClaim>>>;

export const statusInquiry = (r: StatusRow, at: Date): ClaimStatusInquiry | null => {
  if (!r.member_id) return null;
  const self = r.relationship === SELF;
  const patient = {
    lastName: r.last_name,
    firstName: r.first_name,
    birthDate: r.birth_date,
    sex: r.gender
  };
  const lastName = self ? r.last_name : r.insured_last_name;
  if (!lastName) return null;
  return {
    trace: String(r.number),
    payer: { name: r.payer, payerId: r.payer_id },
    subscriber: self
      ? { ...patient, memberId: r.member_id }
      : {
          lastName,
          firstName: r.insured_first_name,
          birthDate: null,
          sex: null,
          memberId: r.member_id
        },
    patient: self ? null : patient,
    claimNumber: String(r.number),
    payerClaimNumber: r.payer_claim_number,
    chargeCents: r.total_cents,
    serviceDate: r.service_date ?? localDate(at, r.time_zone)
  };
};

export const createExchangeStore = ({
  db,
  blobs,
  applyDocument,
  clearinghouseFor,
  now = () => new Date()
}: ExchangeDeps): ExchangeStore => {
  const prepare = async (agencyId: string) => {
    const profile = await findProfile(db, agencyId);
    const submitter: Submitter | null = profile ? toSubmitter(profile) : null;
    const problems = submitterIssues(submitter);
    if (!submitter || problems.length) {
      return unavailable(problems[0] ?? 'Add a billing profile in Settings');
    }
    const clearinghouse = await clearinghouseFor(agencyId);
    if (!clearinghouse) return unavailable(NO_CONNECTION);
    const controlNumber = await allocateControlNumber(db, agencyId);
    if (controlNumber === null) {
      return unavailable('Batch control numbers are used up; contact support');
    }
    return { status: 'ready' as const, submitter, clearinghouse, controlNumber };
  };

  const keep = async (runId: string, agencyId: string, name: string, text: string) => {
    const fileName = `${name}.x12`;
    const ref = await blobs.putBytes(
      `clearinghouse/${agencyId}/${now().getTime()}-${randomUUID().slice(0, 8)}-${fileName}`,
      bytesOf(text),
      'application/edi-x12'
    );
    return { fileName, applied: await applyDocument(runId, ref, fileName) };
  };

  const agencyOf = async (runId: string) =>
    (await runAgency(db, runId).executeTakeFirstOrThrow()).agency_id;

  return {
    checkEligibility: async (runId, claimId) => {
      const agencyId = await agencyOf(runId);
      const row = isUuid(claimId) ? await findEligibilityClaim(db, agencyId, claimId) : undefined;
      if (!row) return unavailable('The claim has no patient to ask about yet');
      const requests = eligibilityRequests(row, now());
      if (!requests.length) return unavailable(NO_CHECKABLE_PAYER);
      const ready = await prepare(agencyId);
      if (ready.status !== 'ready') return ready;
      const { submitter, clearinghouse, controlNumber } = ready;
      const text = build270(submitter, requests, { controlNumber, createdAt: now() });
      const name = exchangeFileName('eligibility', controlNumber, claimId);
      let reason: string | null = null;
      if (clearinghouse.checkEligibility) {
        const answer = await clearinghouse.checkEligibility(text);
        if (answer.ok) {
          const { fileName, applied } = await keep(runId, agencyId, `271-${name}`, answer.text);
          if (applied.status !== 'unreadable') {
            return {
              status: 'answered',
              fileName,
              reviews: applied.status === 'applied' ? applied.reviews : []
            };
          }
          reason = applied.reason;
        } else {
          reason = answer.error;
        }
      }
      const sentAs = await clearinghouse.submitEligibility(name, bytesOf(text));
      return { status: 'sent', sentAs, reason };
    },

    checkClaimStatus: async (runId, claimId, _sourceKey, coverageId) => {
      const agencyId = await agencyOf(runId);
      const row = await statusClaim(db, agencyId, claimId, coverageId);
      if (!row) return unavailable('The payer is not a directory payer on this claim');
      if (!row.submitted) return unavailable('The claim has not been submitted to this payer');
      const inquiry = statusInquiry(row, now());
      if (!inquiry) return unavailable('The payer has no member ID or insured to ask about');
      const ready = await prepare(agencyId);
      if (ready.status !== 'ready') return ready;
      const { submitter, clearinghouse, controlNumber } = ready;
      const text = build276(submitter, [inquiry], { controlNumber, createdAt: now() });
      const name = exchangeFileName('claimStatus', controlNumber, claimId);
      let reason: string | null = null;
      if (clearinghouse.checkClaimStatus) {
        const answer = await clearinghouse.checkClaimStatus(text);
        const status = answer.ok ? statusFor(answer.text, inquiry.claimNumber) : undefined;
        if (answer.ok && status) {
          await keep(runId, agencyId, `277-${name}`, answer.text);
          return { status: 'answered', note: claimStatusNote(status) };
        }
        reason = answer.ok ? 'The answer did not name the claim' : answer.error;
      }
      const sentAs = await clearinghouse.submitClaimStatus(name, bytesOf(text));
      return { status: 'sent', sentAs, reason, signalsSeen: row.received ?? 0 };
    }
  };
};
