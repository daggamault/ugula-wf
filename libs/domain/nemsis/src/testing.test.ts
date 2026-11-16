import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parseDataset } from './parse.ts';
import { fixtureUrl } from './testing.ts';

const names = readdirSync(new URL('./fixtures', import.meta.url)).map((f) =>
  f.replace(/\.xml$/, '')
);

describe('fixtureUrl', () => {
  for (const name of names) {
    it(`${name} parses to at least one report`, () => {
      assert.ok(parseDataset(readFileSync(fixtureUrl(name), 'utf8')).reports.length > 0);
    });
  }
});
