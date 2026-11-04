import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findClaimCheck } from './claim-checks.ts';
import { createRecordingDb } from './testing.ts';

const claim = {
  id: 'c1',
  patient_id: 'p1',
  pcr_number: 'PCR-1',
  trip_type: 'emergency',
  level: 'ALS1',
  emergency: true,
  loaded_miles: '7.3',
  total_cents: 100_000,
  service_date: '2026-10-01',
  origin_code: 'R',
  destination_code: 'H',
  pickup_address_line: '9 Oak Ave',
  pickup_city: 'Springfield',
  pickup_state: 'IL',
  pickup_postal_code: '62702',
  destination_name: 'Mercy',
  destination_address_line: null,
  destination_city: null,
  destination_state: null,
  destination_postal_code: null,
  address_line: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  postal_code: '62701'
};

describe('findClaimCheck', () => {
  it('reads a claim with its patient address, lines, directory-linked payers and diagnoses', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('from "claims"')
        ? [claim]
        : q.sql.includes('from "claim_lines"')
          ? [{ code: 'A0427', units: '1.0', unit_cents: 100_000, total_cents: 100_000 }]
          : q.sql.includes('from "claim_coverages"')
            ? [
                {
                  id: 'cov-1',
                  payer_name: 'Medicare',
                  payer_id: 'p-mcr',
                  claim_filing: 'MB',
                  member_id: 'M1',
                  relationship: '18',
                  insured_first_name: null,
                  insured_last_name: null
                }
              ]
            : [{ code: 'R079' }]
    );
    const check = await findClaimCheck(db, 't1', 'c1');
    assert.equal(check?.loadedMiles, 7.3);
    assert.equal(check?.details.originDestination, 'RH');
    assert.deepEqual(check?.patient?.postalCode, '62701');
    assert.deepEqual(check?.lines, [
      { code: 'A0427', units: 1, unitCents: 100_000, totalCents: 100_000 }
    ]);
    assert.equal(check?.payers[0]?.claimFiling, 'MB');
    assert.deepEqual(check?.details.diagnoses, ['R079']);
    assert.ok(queries[0]?.sql.includes('left join "patients" as "p"'));
    assert.deepEqual(queries[0]?.parameters, ['c1', 't1']);
  });

  it('finds nothing for another agency, and no patient address before the patient is known', async () => {
    const missing = createRecordingDb();
    assert.equal(await findClaimCheck(missing.db, 't1', 'c1'), null);
    assert.equal(missing.queries.length, 1);
    const { db } = createRecordingDb((q) =>
      q.sql.includes('from "claims"')
        ? [{ ...claim, patient_id: null, loaded_miles: null, destination_code: null }]
        : []
    );
    const check = await findClaimCheck(db, 't1', 'c1');
    assert.deepEqual(
      [check?.patient, check?.loadedMiles, check?.payers, check?.details.originDestination],
      [null, null, [], null]
    );
  });
});
