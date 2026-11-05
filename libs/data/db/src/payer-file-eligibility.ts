import { type EligibilityResult, eligibilityFinding, type FacilityStayHint } from '@ugula/billing';
import {
  type Context,
  type FileItem,
  item,
  type Posted,
  recordPayerEvent
} from './payer-file-items.ts';
import type { Db } from './schema.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const findTracedCoverage = async (db: Db, agencyId: string, trace: string) =>
  UUID.test(trace)
    ? db
        .selectFrom('claim_coverages')
        .leftJoin('payers', 'payers.id', 'claim_coverages.payer_id')
        .select(['claim_coverages.id', 'claim_coverages.claim_id', 'payers.claim_filing'])
        .where('claim_coverages.agency_id', '=', agencyId)
        .where('claim_coverages.id', '=', trace.toLowerCase())
        .executeTakeFirst()
    : undefined;

const saveEligibility = (
  db: Db,
  coverageId: string,
  e: { active: boolean; note: string; checkedAt: Date; stay: FacilityStayHint | null }
) =>
  db
    .updateTable('claim_coverages')
    .set({
      eligibility: e.active ? 'active' : 'inactive',
      eligibility_note: e.note || null,
      eligibility_checked_at: e.checkedAt,
      stay_kind: e.stay?.kind ?? null,
      stay_admitted_on: e.stay?.admittedOn ?? null,
      stay_discharged_on: e.stay?.dischargedOn ?? null
    })
    .where('id', '=', coverageId)
    .execute();

const eligibilityLabel = (active: boolean | null) =>
  active === null ? null : active ? 'Coverage active' : 'Coverage not active';

export const postEligibility = async (
  c: Context,
  results: EligibilityResult[]
): Promise<Posted> => {
  const items: FileItem[] = [];
  let n = 0;
  for (const r of results) {
    n += 1;
    const coverage = await findTracedCoverage(c.tx, c.agencyId, r.trace);
    if (!coverage) {
      items.push(item(r.trace, null, 'unmatched', 'No payer on a claim matches this response'));
      continue;
    }
    const found = eligibilityFinding(r, coverage.claim_filing);
    if (found.active !== null) {
      await saveEligibility(c.tx, coverage.id, {
        active: found.active,
        note: found.note,
        checkedAt: c.now,
        stay: r.stay
      });
    }
    await recordPayerEvent(c, coverage.claim_id, coverage.id, {
      kind: 'eligibility',
      note: [eligibilityLabel(found.active), found.note].filter(Boolean).join(': '),
      payerClaimNumber: null,
      key: String(n)
    });
    items.push(item(r.trace, coverage.claim_id, found.outcome, found.note));
  }
  return { items, envelopeRejection: null };
};
