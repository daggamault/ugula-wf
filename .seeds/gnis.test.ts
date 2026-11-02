import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { deflateRawSync, gzipSync } from 'node:zlib';
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
import { buildPlaces, PLACES_FILE } from './gnis-build.ts';
import { unzipTexts } from './zip.ts';

const zipOf = (name: string, text: string) => {
  const data = deflateRawSync(Buffer.from(text));
  const nameBytes = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  const directoryAt = local.length + nameBytes.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12);
  end.writeUInt32LE(directoryAt, 16);
  return Buffer.concat([local, nameBytes, data, central, nameBytes, end]);
};

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

  it('reads text files out of zip archives and round-trips the compact format', () => {
    assert.deepEqual(
      unzipTexts(zipOf('Text/a.txt', 'hello'), (n) => n.endsWith('.txt')),
      ['hello']
    );
    assert.deepEqual(
      unzipTexts(zipOf('a.jpg', 'x'), (n) => n.endsWith('.txt')),
      []
    );
    assert.throws(() => unzipTexts(Buffer.from('nope'), () => true), /zip/);
    const places = [{ id: 1215209, name: 'Erie', state: 'PA' }];
    assert.deepEqual(fromTsv(toTsv(places)), places);
    assert.deepEqual(readPlaces(gzipSync(toTsv(places))), places);
    assert.deepEqual(
      federalCodeFiles('<Key>x/FedCodes_PA_Text.zip</Key><Key>x/FedCodes_PA_Text.zip</Key>'),
      ['FedCodes_PA_Text.zip']
    );
  });

  it('builds the place list from every federal codes file and the populated places file', async () => {
    const files: Record<string, Buffer> = {
      list: Buffer.from('<Key>FederalCodes/FedCodes_PA_Text.zip</Key>'),
      fed: zipOf('Text/FedCodes_PA.txt', FEDERAL),
      pop: zipOf('Text/PopulatedPlaces_National.txt', POPULATED)
    };
    const places = await buildPlaces(async (url) =>
      url.includes('?prefix=')
        ? (files.list as Buffer)
        : url.includes('FedCodes')
          ? (files.fed as Buffer)
          : (files.pop as Buffer)
    );
    assert.equal(places.length, 4);
    await assert.rejects(() => buildPlaces(async () => Buffer.from('')), /No GNIS/);
  });

  it('ships the place file with the codes NEMSIS exports use', () => {
    const places = new Map(readPlaces(readFileSync(PLACES_FILE)).map((p) => [p.id, p]));
    assert.ok(places.size > 200_000);
    assert.deepEqual(places.get(1215209), { id: 1215209, name: 'Erie', state: 'PA' });
    assert.deepEqual(places.get(1192443), { id: 1192443, name: 'Fairview', state: 'PA' });
  });

  it('upserts places by feature id', async () => {
    const db = createDummyDb();
    const { sql } = buildUpsertPlaces(db, [{ id: 1, name: 'A', state: 'PA' }]).compile();
    assert.ok(sql.includes('insert into "gnis_places"'));
    assert.ok(sql.includes('on conflict ("id") do update set'));
    await db.destroy();
  });
});
