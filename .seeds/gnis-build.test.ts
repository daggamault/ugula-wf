import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { readPlaces } from './gnis.ts';
import { buildPlaces, PLACES_FILE } from './gnis-build.ts';
import { zipOf } from './testing.ts';

const POPULATED = `feature_id|feature_name|feature_class|state_name|state_numeric|county_name
1192443|Fairview|Populated Place|Pennsylvania|42|Erie
`;

const FEDERAL = `feature_id|feature_name|feature_class|census_code|census_class_code|state_name|state_numeric
1215209|City of Erie|Civil|24000|C5|Pennsylvania|42
1192443|Fairview|Populated Place|||Pennsylvania|42
`;

describe('buildPlaces', () => {
  it('merges every federal codes file listed with the populated places file', async () => {
    const urls: string[] = [];
    const places = await buildPlaces(async (url) => {
      urls.push(url);
      if (url.includes('?prefix=')) {
        return Buffer.from(
          '<Key>FederalCodes/FedCodes_PA_Text.zip</Key><Key>FederalCodes/FedCodes_OH_Text.zip</Key>'
        );
      }
      return url.includes('FedCodes_PA')
        ? zipOf({ 'Text/FedCodes_PA.txt': FEDERAL })
        : url.includes('FedCodes_OH')
          ? zipOf({ 'Text/FedCodes_OH.txt': '' })
          : zipOf({ 'Text/PopulatedPlaces_National.txt': POPULATED });
    });
    assert.deepEqual(places, [
      { id: 1192443, name: 'Fairview', state: 'PA' },
      { id: 1215209, name: 'Erie', state: 'PA' }
    ]);
    assert.equal(urls.length, 4);
  });

  it('fails when the listing names no federal codes files', async () => {
    await assert.rejects(() => buildPlaces(async () => Buffer.from('')), /No GNIS/);
  });

  it('ships the place file with the codes NEMSIS exports use', () => {
    const places = new Map(readPlaces(readFileSync(PLACES_FILE)).map((p) => [p.id, p]));
    assert.ok(places.size > 200_000);
    assert.deepEqual(places.get(1215209), { id: 1215209, name: 'Erie', state: 'PA' });
    assert.deepEqual(places.get(1192443), { id: 1192443, name: 'Fairview', state: 'PA' });
  });
});
