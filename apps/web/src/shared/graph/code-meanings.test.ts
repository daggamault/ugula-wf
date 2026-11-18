import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCodeMeanings, MEANINGS_LIMIT } from './code-meanings.ts';

describe('createCodeMeanings', () => {
  it('asks once per kind and codes, and gives the meanings by code', async () => {
    const asked: [string, readonly string[]][] = [];
    const meanings = createCodeMeanings(async (kind, codes) => {
      asked.push([kind, codes]);
      return [{ code: '4212007', description: 'Canceled' }];
    });
    const first = await meanings('incidentDisposition', ['4212007', '4212007']);
    await meanings('incidentDisposition', ['4212007']);
    assert.equal(first.get('4212007'), 'Canceled');
    assert.deepEqual(asked, [['incidentDisposition', ['4212007']]]);
  });

  it('asks for no more than the limit', async () => {
    let size = 0;
    const meanings = createCodeMeanings(async (_, codes) => {
      size = codes.length;
      return [];
    });
    await meanings(
      'snomed',
      Array.from({ length: MEANINGS_LIMIT + 5 }, (_, i) => String(i))
    );
    assert.equal(size, MEANINGS_LIMIT);
  });

  it('gives no meanings when asking fails, and asks again next time', async () => {
    let calls = 0;
    const meanings = createCodeMeanings(async () => {
      calls += 1;
      throw new Error('offline');
    });
    assert.equal((await meanings('yesNo', ['9923003'])).size, 0);
    await meanings('yesNo', ['9923003']);
    assert.equal(calls, 2);
  });
});
