import {
  isDenialRoute,
  money,
  type ProviderAdjustment,
  type Remittance,
  type RemittanceClaim,
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

const postedPayment = async (db: Db, coverageId: string, payerClaimNumber: string | null) =>
  payerClaimNumber !== null &&
  (await db
    .selectFrom('claim_events')
    .select('id')
    .where('coverage_id', '=', coverageId)
    .where('kind', '=', 'response')
    .where('payer_claim_number', '=', payerClaimNumber)
    .executeTakeFirst()) !== undefined;

const matchRemittance = async (
  db: Db,
  agencyId: string,
  remit: Remittance,
  rc: RemittanceClaim
) => {
  const claim = await findClaimByNumber(db, agencyId, rc.claimNumber);
  const coverages = claim ? await listPostingCoverages(db, claim.id) : [];
  const coverage = claim ? remittanceCoverage(coverages, remit.payerId, rc.status) : null;
  return {
    claimId: claim?.id ?? null,
    coverageId: coverage?.id ?? null,
    nextCoverageId: coverage ? (coverages[coverages.indexOf(coverage) + 1]?.id ?? null) : null,
    reversesPosted:
      rc.reversal &&
      coverage !== null &&
      (await postedPayment(db, coverage.id, rc.payerClaimNumber))
  };
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
    const { claimId, coverageId, reversesPosted } = await matchRemittance(db, agencyId, remit, rc);
    lines.push(
      remittanceLine(position, rc, {
        claimId,
        coverageId,
        reversesPosted,
        payerName: remit.payerName
      })
    );
  }
  return lines;
};

const findClaimByPayerNumber = async (db: Db, agencyId: string, payerClaimNumber: string) =>
  (
    await db
      .selectFrom('claim_events as e')
      .innerJoin('claims as c', 'c.id', 'e.claim_id')
      .select('e.claim_id')
      .where('c.agency_id', '=', agencyId)
      .where('e.payer_claim_number', '=', payerClaimNumber)
      .where('e.kind', '=', 'response')
      .limit(1)
      .executeTakeFirst()
  )?.claim_id ?? null;

const providerItem = async (c: Context, remit: Remittance, a: ProviderAdjustment) =>
  item(
    `PLB ${[a.reason, a.reference ?? remit.checkNumber ?? remit.payerName].filter(Boolean).join(' ')}`,
    a.reference ? await findClaimByPayerNumber(c.tx, c.agencyId, a.reference) : null,
    'review',
    `${remit.payerName ?? 'The payer'} made a provider-level adjustment (PLB ${a.reason}) of ${money(a.cents)} on this payment, such as a recoupment of an earlier payment; post it on the claim it belongs to by hand`
  );

const postPayment = async (
  c: Context,
  { remit, rc, position }: ReturnType<typeof eachClaimPayment>[number]
): Promise<FileItem> => {
  const posting = c.postings.find((p) => p.position === position);
  if (!posting) throw new Error(`No posting was decided for claim payment ${position} of the file`);
  const { claimId, coverageId, nextCoverageId, reversesPosted } = await matchRemittance(
    c.tx,
    c.agencyId,
    remit,
    rc
  );
  if (!claimId || posting.route === 'unmatched') {
    return item(
      rc.claimNumber,
      claimId,
      'unmatched',
      posting.message || `No claim has number ${rc.claimNumber}`
    );
  }
  if (posting.route === 'review' || !coverageId) {
    return item(
      rc.claimNumber,
      claimId,
      'review',
      posting.message ||
        `${remit.payerName ?? 'The payer'} is not a payer on this claim; post the payment by hand`
    );
  }
  const line = remittanceLine(position, rc, {
    claimId,
    coverageId,
    payerName: remit.payerName,
    reversesPosted
  });
  const amounts = { paidCents: line.paidCents, adjustedCents: posting.adjustedCents };
  const reversal = posting.route === 'reversal';
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
    exactAdjustment: true,
    reversal,
    note: `${reversal ? 'Reversal' : isDenialRoute(posting.route) ? 'Denied' : 'Remittance'} from ${remit.payerName ?? 'the payer'} in ${c.fileName}`
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
  if (posted.ok && !posted.value.duplicate && posting.crossover && nextCoverageId) {
    await c.tx
      .insertInto('claim_events')
      .values({
        claim_id: claimId,
        kind: 'crossed_over',
        coverage_id: nextCoverageId,
        note: `${remit.payerName ?? 'The payer'} forwarded the claim${rc.crossoverPayer ? ` to ${rc.crossoverPayer}` : ''}; wait for its payment before billing it`,
        created_by: c.userId,
        source_key: `${c.digest}:${position}:crossed_over`
      })
      .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
      .execute();
  }
  return posted.ok
    ? item(
        rc.claimNumber,
        claimId,
        posted.value.duplicate ? 'duplicate' : 'posted',
        reversal ? 'Reversed' : isDenialRoute(posting.route) ? 'Denied' : '',
        { ...amounts, adjustedCents: posted.value.adjustedCents }
      )
    : item(rc.claimNumber, claimId, 'review', posted.failure.message);
};

export const postRemittances = async (c: Context, remittances: Remittance[]) => {
  const payments = eachClaimPayment(remittances);
  const posted = new Map<number, FileItem>();
  for (const payment of [
    ...payments.filter((p) => p.rc.reversal),
    ...payments.filter((p) => !p.rc.reversal)
  ]) {
    posted.set(payment.position, await postPayment(c, payment));
  }
  const items = payments.flatMap((p) => posted.get(p.position) ?? []);
  for (const remit of remittances) {
    for (const a of remit.providerAdjustments) {
      if (a.cents !== 0) items.push(await providerItem(c, remit, a));
    }
  }
  return items;
};
