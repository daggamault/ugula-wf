import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from './api.ts';
import { type Code, createCodesClient } from './codes.ts';

const chestPain: Code = { code: 'R079', description: 'Chest pain, unspecified', is_billable: true };

const fakeCodes = () => {
  const calls: { url: string; signal: AbortSignal | null | undefined }[] = [];
  const client = createCodesClient(
    createApi(
      '',
      async (url, init) => {
        calls.push({ url: String(url), signal: init?.signal });
        return new Response(JSON.stringify({ codes: [chestPain] }), { status: 200 });
      },
      () => undefined,
      () => null
    )
  );
  return { calls, client };
};

describe('createCodesClient', () => {
  it('searches a code set by text and returns its codes', async () => {
    const { calls, client } = fakeCodes();
    assert.deepEqual(await client.search('icd10cm', 'chest pain', null), [chestPain]);
    assert.deepEqual(
      calls.map((c) => c.url),
      ['/api/codes?set=icd10cm&q=chest+pain']
    );
  });

  it('narrows a search to a named list when one is given', async () => {
    const { calls, client } = fakeCodes();
    await client.search('icd10cm', '', 'impression');
    assert.deepEqual(
      calls.map((c) => c.url),
      ['/api/codes?set=icd10cm&q=&list=impression']
    );
  });

  it('describes the chosen codes in one request', async () => {
    const { calls, client } = fakeCodes();
    assert.deepEqual(await client.describe('icd10cm', ['R079', 'I10']), [chestPain]);
    assert.deepEqual(
      calls.map((c) => c.url),
      ['/api/codes?set=icd10cm&codes=R079%2CI10']
    );
  });

  it('describes codes of a kind in one request, and none without one', async () => {
    const { calls, client } = fakeCodes();
    assert.deepEqual(await client.describeKind('incidentDisposition', ['4212007', '4212009']), [
      chestPain
    ]);
    assert.deepEqual(await client.describeKind('yesNo', []), []);
    assert.deepEqual(
      calls.map((c) => c.url),
      ['/api/codes/kind?kind=incidentDisposition&codes=4212007%2C4212009']
    );
  });

  it('describes an empty list without a request', async () => {
    const { calls, client } = fakeCodes();
    assert.deepEqual(await client.describe('icd10cm', []), []);
    assert.deepEqual(calls, []);
  });

  it('hands the abort signal of a search and a describe to fetch', async () => {
    const { calls, client } = fakeCodes();
    const controller = new AbortController();
    await client.search('icd10cm', 'chest', null, controller.signal);
    await client.describe('icd10cm', ['R079'], controller.signal);
    assert.deepEqual(
      calls.map((c) => c.signal),
      [controller.signal, controller.signal]
    );
  });
});
