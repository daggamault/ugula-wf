import { createHash } from 'node:crypto';
import type { ClaimStore } from '@ugula/billing';
import type { Db } from '@ugula/db';
import type { BlobStore } from '@ugula/storage';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';
import { agencyClaim, payerName } from './claim-scope.ts';

const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

export const statementKey = (
  agencyId: string,
  claimId: string,
  number: number,
  sourceKey: string
) =>
  `statements/${agencyId}/${claimId}/${number}-${createHash('sha256').update(sourceKey).digest('hex').slice(0, 16)}.pdf`;

const PAYMENT_KINDS = ['response', 'refunded'] as const;

export const createStatementStore = (
  db: Db,
  blobs: Pick<BlobStore, 'putBytes'>
): Pick<ClaimStore, 'statementData' | 'saveStatement'> => ({
  statementData: async (runId, claimId) => {
    const row = await db
      .selectFrom('claims as c')
      .innerJoin('patients as p', 'p.id', 'c.patient_id')
      .leftJoin('billing_profiles as b', 'b.agency_id', 'c.agency_id')
      .select([
        'c.id',
        'c.pcr_number',
        'c.total_cents',
        'c.service_date',
        'p.first_name',
        'p.last_name',
        'p.address_line',
        'p.city',
        'p.state',
        'p.postal_code',
        'b.organization_name',
        'b.address_line as agency_address',
        'b.city as agency_city',
        'b.state as agency_state',
        'b.postal_code as agency_postal_code',
        'b.phone',
        'b.time_zone'
      ])
      .where('c.id', '=', isUuid(claimId) ? claimId : null)
      .where('c.agency_id', '=', runAgency(db, runId))
      .executeTakeFirst();
    if (!row) throw new Error(`Claim ${claimId} does not exist`);
    const [lines, payments] = await Promise.all([
      db
        .selectFrom('claim_lines as l')
        .leftJoin('codes as d', (j) =>
          j.on('d.code_set', '=', 'hcpcs').onRef('d.code', '=', 'l.code')
        )
        .select(['l.code', 'l.units', 'l.unit_cents', 'l.total_cents', 'd.description'])
        .where('l.claim_id', '=', row.id)
        .orderBy('l.position')
        .execute(),
      db
        .selectFrom('claim_events as e')
        .leftJoin('claim_coverages as cc', 'cc.id', 'e.coverage_id')
        .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
        .select([
          payerName.as('payer'),
          'e.paid_cents',
          'e.adjusted_cents',
          'e.paid_on',
          'e.created_at'
        ])
        .where('e.claim_id', '=', row.id)
        .where('e.kind', 'in', PAYMENT_KINDS)
        .where((eb) => eb.or([eb('e.paid_cents', '<>', 0), eb('e.adjusted_cents', '<>', 0)]))
        .orderBy('e.created_at')
        .orderBy('e.id')
        .execute()
    ]);
    const paid = payments.map((r) => ({
      date: r.paid_on ?? day(r.created_at),
      from: r.payer ?? 'Patient',
      paidCents: r.paid_cents,
      adjustedCents: r.adjusted_cents
    }));
    return {
      agency:
        row.organization_name === null || row.phone === null || row.time_zone === null
          ? null
          : {
              name: row.organization_name,
              addressLine: row.agency_address,
              city: row.agency_city,
              state: row.agency_state,
              postalCode: row.agency_postal_code,
              phone: row.phone,
              timeZone: row.time_zone
            },
      patient: {
        name: `${row.first_name} ${row.last_name}`,
        addressLine: row.address_line,
        city: row.city,
        state: row.state,
        postalCode: row.postal_code
      },
      reference: row.pcr_number ?? row.id.slice(0, 8),
      serviceDate: row.service_date,
      lines: lines.map((l) => ({
        code: l.code,
        units: Number(l.units),
        unitCents: l.unit_cents,
        totalCents: l.total_cents,
        description: l.description
      })),
      totalCents: row.total_cents,
      payments: paid,
      balanceCents: paid.reduce((b, p) => b - p.paidCents - p.adjustedCents, row.total_cents)
    };
  },

  saveStatement: async (runId, claimId, sourceKey, { number, count, pdf }) => {
    const claim = await agencyClaim(db, runId, claimId);
    const document = await blobs.putBytes(
      statementKey(claim.agency_id, claim.id, number, sourceKey),
      pdf,
      'application/pdf'
    );
    await db
      .insertInto('claim_events')
      .values({
        claim_id: claim.id,
        kind: 'statement',
        note: `Patient statement ${number} of ${count}`,
        document: JSON.stringify(document),
        source_key: sourceKey
      })
      .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
      .execute();
  }
});
