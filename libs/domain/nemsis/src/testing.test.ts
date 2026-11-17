import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parseDataset, pcrNumberOf } from './parse.ts';
import { fixtureUrl } from './testing.ts';

const names = readdirSync(new URL('./fixtures', import.meta.url)).map((f) =>
  f.replace(/\.xml$/, '')
);

const pcrNumbers = (name: string) =>
  parseDataset(readFileSync(fixtureUrl(name), 'utf8')).reports.map(pcrNumberOf);

describe('fixtureUrl', () => {
  it('locates a fixture by name', () => {
    assert.equal(
      fixtureUrl('als1-iv-solutions').pathname.endsWith('/fixtures/als1-iv-solutions.xml'),
      true
    );
  });

  for (const name of names) {
    it(`${name} parses to reports that each carry a PCR number`, () => {
      const numbers = pcrNumbers(name);
      assert.notDeepEqual(numbers, []);
      for (const n of numbers) assert.match(n ?? '', /^PCR-1\d{3}(-\d+)?$/, name);
    });
  }

  it('gives each fixture its own PCR numbers, shared only by a corrected report and its original', () => {
    const owners = new Map<string, string>();
    for (const name of names) {
      for (const n of pcrNumbers(name)) {
        const owner = owners.get(n ?? '');
        if (owner)
          assert.deepEqual(
            [owner, name].sort(),
            [name.replace(/-corrected$/, ''), `${name.replace(/-corrected$/, '')}-corrected`],
            n ?? ''
          );
        else owners.set(n ?? '', name);
      }
    }
  });
});
