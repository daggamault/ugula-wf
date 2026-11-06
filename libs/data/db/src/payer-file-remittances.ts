import {
  isDenialRoute,
  money,
  type Remittance,
  type RemittanceLine,
  read835,
  remittanceCoverage,
  remittanceLine
} from '@ugula/billing';
import { postClaimResponse } from './claim-responses.ts';
import { type Context, type FileItem, findClaimByNumber, item } from './payer-file-items.ts';
import type { Db } from './schema.ts';

const listPostingCoverages = (db: Db, claimId: string) =>
  db
    .selectFrom('claim_coverages as cc')
    .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
    .select(['cc.id', 'dp.payer_id as payerId'])
    .where('cc.claim_id', '=', claimId)
    .orderBy('cc.position')
    .execute();

const matchRemittance = async (
  db: Db,
  agencyId: string,
  remit: Remittance,
  claimNumber: string,
  status: string
) => {
  const claim = await findClaimByNumber(db, agencyId, claimNumber);
  const coverage = claim
    ? remittanceCoverage(await listPostingCoverages(db, claim.id), remit.payerId, status)
    : null;
  return { claimId: claim?.id ?? null, coverageId: coverage?.id ?? null };
};

const eachClaimPayment = (remittances: Remittance[]) =>
  remittances
    .flatMap((remit) => remit.claims.map((rc) => ({ remit, rc })))
    .map((x, i) => ({
      ...x,
      position: i + 1
    }));

export const readRemittanceLines = async (
  db: Db,
  agencyId: string,
  text: string
): Promise<RemittanceLine[]> => {
  const lines: RemittanceLine[] = [];
  for (const { remit, rc, position } of eachClaimPayment(read835(text))) {
    const matched = await matchRemittance(db, agencyId, remit, rc.claimNumber, rc.status);
    lines.push(remittanceLine(position, rc, { ...matched, payerName: remit.payerName }));
  }
  return lines;
};

export const postRemittances = async (c: Context, remittances: Remittance[]) => {
  const items: FileItem[] = [];
  for (const { remit, rc, position } of eachClaimPayment(remittances)) {
    const posting = c.postings.find((p) => p.position === position);
    if (!posting)
      throw new Error(`No posting was decided for claim payment ${position} of the file`);
    const { claimId, coverageId } = await matchRemittance(
      c.tx,
      c.agencyId,
      remit,
      rc.claimNumber,
      rc.status
    );
    if (!claimId || posting.route === 'unmatched') {
      items.push(
        item(
          rc.claimNumber,
          claimId,
          'unmatched',
          posting.message || `No claim has number ${rc.claimNumber}`
        )
      );
      continue;
    }
    if (posting.route === 'review' || !coverageId) {
      items.push(
        item(
          rc.claimNumber,
          claimId,
          'review',
          posting.message ||
            `${remit.payerName ?? 'The payer'} is not a payer on this claim; post the payment by hand`
        )
      );
      continue;
    }
    const line = remittanceLine(position, rc, { claimId, coverageId, payerName: remit.payerName });
    const amounts = { paidCents: line.paidCents, adjustedCents: posting.adjustedCents };
    const posted = await postClaimResponse(c.tx, c.boss, c.agencyId, claimId, c.userId, {
      requestId: `${c.digest}:${position}`,
      kind: 'response',
      coverageId,
      ...amounts,
      paidOn: remit.paidOn,
      checkNumber: remit.checkNumber,
      payerClaimNumber: rc.payerClaimNumber,
      adjustments: line.adjustments,
      remarks: rc.remarks,
      note: `${rc.denied ? 'Denied' : 'Remittance'} from ${remit.payerName ?? 'the payer'} in ${c.fileName}`
    });
    if (posted.ok && !posted.value.duplicate && isDenialRoute(posting.route)) {
      await c.tx
        .insertInto('claim_events')
        .values({
          claim_id: claimId,
          kind: 'denied',
          coverage_id: coverageId,
          route: posting.route,
          note: posting.message || `Denied by ${remit.payerName ?? 'the payer'}`,
          created_by: c.userId,
          source_key: `${c.digest}:${position}:denied`
        })
        .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
        .execute();
    }
    items.push(
      posted.ok
        ? item(
            rc.claimNumber,
            claimId,
            posted.value.duplicate ? 'duplicate' : 'posted',
            rc.denied ? 'Denied' : '',
            { ...amounts, adjustedCents: posted.value.adjustedCents }
          )
        : item(rc.claimNumber, claimId, 'review', posted.failure.message)
    );
  }
  for (const remit of remittances) {
    if (remit.providerAdjustmentCents === 0) continue;
    items.push(
      item(
        `PLB ${remit.checkNumber ?? remit.payerName ?? 'payment'}`,
        null,
        'review',
        `${remit.payerName ?? 'The payer'} made provider-level adjustments (PLB) of ${money(remit.providerAdjustmentCents)} on this payment, such as a recoupment of an earlier payment; post them on the claims they belong to by hand`
      )
    );
  }
  return items;
};
