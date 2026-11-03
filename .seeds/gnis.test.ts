import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';
import { createDummyDb } from '@ugula/db/testing';
import {
  buildUpsertPlaces,
  federalCodeFiles,
  fromTsv,
  mergePlaces,
  parseFederalCodes,
  parsePopulatedPlaces,
  placeName,
  readPlaces,
  toTsv
} from './gnis.ts';

const POPULATED = `﻿feature_id|feature_name|feature_class|state_name|state_numeric|county_name
1192443|Fairview|Populated Place|Pennsylvania|42|Erie
1|Nowhere|Populated Place|Atlantis|99|Sea
`;

const FEDERAL = `﻿feature_id|feature_name|feature_class|census_code|census_class_code|state_name|state_numeric
1215209|City of Erie|Civil|24000|C5|Pennsylvania|42
1214000|Erie County|Civil|049|H1|Pennsylvania|42
1192443|Fairview|Populated Place|||Pennsylvania|42
2389998|Lawrence Park Census Designated Place|Census|42500|U1|Pennsylvania|42
1216000|Township of Millcreek (historical)|Civil|49128|T1|Pennsylvania|42
`;

describe('GNIS places', () => {
  it('cleans civil and census names down to the place name', () => {
    assert.equal(placeName('City of Erie'), 'Erie');
    assert.equal(placeName('Charter Township of Canton'), 'Canton');
    assert.equal(placeName('Elysburg Census Designated Place'), 'Elysburg');
    assert.equal(placeName('Township of Pahaquarry (historical)'), 'Pahaquarry');
    assert.equal(placeName('Village of Village of the Branch'), 'Village of the Branch');
  });

  it('keeps populated, incorporated and census places with their USPS state', () => {
    assert.deepEqual(parsePopulatedPlaces(POPULATED), [
      { id: 1192443, name: 'Fairview', state: 'PA' }
    ]);
    assert.deepEqual(
      parseFederalCodes(FEDERAL).map((p) => p.id),
      [1215209, 1192443, 2389998, 1216000]
    );
    assert.deepEqual(
      mergePlaces(parsePopulatedPlaces(POPULATED), parseFederalCodes(FEDERAL)).map((p) => p.name),
      ['Fairview', 'Erie', 'Millcreek', 'Lawrence Park']
    );
  });

  it('round-trips the compact format and finds the federal codes files', () => {
    const places = [{ id: 1215209, name: 'Erie', state: 'PA' }];
    assert.deepEqual(fromTsv(toTsv(places)), places);
    assert.deepEqual(readPlaces(gzipSync(toTsv(places))), places);
    assert.deepEqual(
      federalCodeFiles('<Key>x/FedCodes_PA_Text.zip</Key><Key>x/FedCodes_PA_Text.zip</Key>'),
      ['FedCodes_PA_Text.zip']
    );
  });

  it('upserts places by feature id', async () => {
    const db = createDummyDb();
    const { sql } = buildUpsertPlaces(db, [{ id: 1, name: 'A', state: 'PA' }]).compile();
    assert.ok(sql.includes('insert into "gnis_places"'));
    assert.ok(sql.includes('on conflict ("id") do update set'));
    await db.destroy();
  });
});
