import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from './api.ts';
import { createCodesClient } from './codes.ts';

describe('createCodesClient', () => {
  it('searches a code set and describes chosen codes, skipping an empty list', async () => {
    const seen: string[] = [];
    const client = createCodesClient(
      createApi('', async (url) => {
        seen.push(String(url));
        return new Response(
          '{"codes":[{"code":"R079","description":"Chest pain, unspecified","billable":true}]}',
          { status: 200 }
        );
      })
    );
    assert.equal((await client.search('icd10cm', 'chest pain', null))[0]?.code, 'R079');
    await client.search('icd10cm', '', 'impression');
    await client.describe('icd10cm', ['R079', 'I10']);
    assert.deepEqual(await client.describe('icd10cm', []), []);
    assert.deepEqual(seen, [
      '/api/codes?set=icd10cm&q=chest+pain',
      '/api/codes?set=icd10cm&q=&list=impression',
      '/api/codes?set=icd10cm&codes=R079%2CI10'
    ]);
  });
});
