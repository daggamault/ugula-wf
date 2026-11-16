import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createReferenceStore } from './queries.ts';

describe('createReferenceStore', () => {
  it('finds one code of a set', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.parameters.includes('R07')
        ? [{ description: 'Pain in throat and chest', billable: false }]
        : []
    );
    const store = createReferenceStore(db);
    assert.deepEqual(await store.findCode('icd10cm', 'R07'), {
      description: 'Pain in throat and chest',
      billable: false
    });
    assert.equal(await store.findCode('icd10cm', 'Z99'), null);
    assert.equal(
      queries[0]?.sql,
      'select "description", "billable" from "codes" where "code_set" = $1 and "code" = $2'
    );
  });

  it('finds the locality of a ZIP+4 from its range, falling back to the ZIP', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.parameters.includes('01434')
        ? [{ carrier: '14212', locality: '99', rurality: 'urban', needs_plus_four: true }]
        : []
    );
    const store = createReferenceStore(db);
    assert.deepEqual(await store.medicareLocality('014343900'), {
      carrier: '14212',
      locality: '99',
      rurality: 'urban',
      plusFourNeeded: false
    });
    assert.equal((await store.medicareLocality('01434'))?.plusFourNeeded, true);
    assert.equal(await store.medicareLocality('00000'), null);
    const [q] = queries;
    assert.ok(
      q?.sql.includes(
        'left join "cms_zip4_localities" as "p" on "p"."postal_code" = "z"."postal_code" and $1 between "p"."plus_four_from" and "p"."plus_four_to"'
      )
    );
    assert.ok(q?.sql.includes('coalesce("p"."rurality", "z"."rurality") as "rurality"'));
    assert.deepEqual(q?.parameters, ['3900', '01434']);
    assert.deepEqual(queries[1]?.parameters, [null, '01434']);
  });

  it("reads the locality's fees for the codes and skips an empty lookup", async () => {
    const { db, queries } = createRecordingDb(() => [
      {
        code: 'A0425',
        urban_cents: 933,
        rural_cents: 942,
        super_rural_cents: null,
        rural_short_trip_cents: 1413
      }
    ]);
    const store = createReferenceStore(db);
    assert.deepEqual(await store.medicareFees(2026, '02102', '01', ['A0425', 'A0427']), [
      {
        code: 'A0425',
        urbanCents: 933,
        ruralCents: 942,
        superRuralCents: null,
        ruralShortTripCents: 1413
      }
    ]);
    assert.deepEqual(await store.medicareFees(2026, '02102', '01', []), []);
    assert.equal(queries.length, 1);
    assert.ok(queries[0]?.sql.startsWith('select "code", "urban_cents"'));
    assert.deepEqual(queries[0]?.parameters, [2026, '02102', '01', 'A0425', 'A0427']);
  });

  it('finds the place of a ZIP', async () => {
    const { db } = createRecordingDb(() => [
      {
        postal_code: '36301',
        city: 'Dothan',
        state: 'AL',
        county: 'Houston',
        county_fips: '01069',
        latitude: 31.14,
        longitude: -85.4
      }
    ]);
    assert.deepEqual(await createReferenceStore(db).zipPlace('36301'), {
      postalCode: '36301',
      city: 'Dothan',
      state: 'AL',
      county: 'Houston',
      countyFips: '01069',
      latitude: 31.14,
      longitude: -85.4
    });
  });

  it('picks the hospital whose name stands out from the candidates in the state', async () => {
    const row = (ccn: string, postalCode: string, similarity: number) => ({
      ccn,
      name: `HOSPITAL ${ccn}`,
      address_line: '1 MAIN ST',
      city: 'DOTHAN',
      state: 'AL',
      postal_code: postalCode,
      phone: null,
      hospital_type: 'Acute Care Hospitals',
      emergency_services: true,
      similarity
    });
    const { db, queries } = createRecordingDb((q) =>
      q.parameters.includes('Southeast Health')
        ? [row('010001', '36301', 0.52)]
        : [row('010002', '36301', 0.75), row('010003', '36360', 0.75)]
    );
    const store = createReferenceStore(db);
    assert.equal((await store.findHospital('Southeast Health', 'AL', null))?.ccn, '010001');
    assert.equal(await store.findHospital('Medical Center', 'AL', '35042'), null);
    assert.equal((await store.findHospital('Medical Center', 'AL', '36360'))?.ccn, '010003');
    const [q] = queries;
    assert.ok(q?.sql.includes('similarity($1, name) as "similarity"'));
    assert.ok(
      q?.sql.endsWith(
        'where "state" = $2 and word_similarity($3, name) >= $4 and similarity($5, name) >= $6 order by "similarity" desc, "ccn" limit $7'
      )
    );
    assert.deepEqual(q?.parameters, [
      'Southeast Health',
      'AL',
      'Southeast Health',
      0.6,
      'Southeast Health',
      0.3,
      5
    ]);
  });
});
