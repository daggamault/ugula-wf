import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { CompiledQuery } from 'kysely';
import { recordAnnouncements } from '../../shared/testing.ts';
import { createPayerService } from './service.ts';

const PAGE = { page: 1, pageSize: 25, sort: 'name', dir: 'asc' } as const;

const ALL = { create: true, update: true };

const INPUT = {
  name: 'Medicare',
  payerCode: '00952',
  claimFiling: 'MB',
  filingLimitDays: null,
  correctionMethod: null,
  appealDays: null,
  planType: null,
  isSearchable: false
} as const;

const ROW = { id: 'p1', name: 'Medicare', payer_code: '00952', claim_filing: 'MB' };

const embedder = (vectors: number[][] | Error) => {
  const texts: string[][] = [];
  return {
    texts,
    embed: async (t: string[]) => {
      texts.push(t);
      if (vectors instanceof Error) throw vectors;
      return vectors;
    }
  };
};

const setup = (rows: (q: CompiledQuery) => unknown[], e = embedder([])) => {
  const { db, queries } = createRecordingDb(rows);
  const { publish, events } = recordAnnouncements();
  return { queries, events, service: createPayerService({ db, publish, embedder: e }) };
};

const notFound = (message: string) => ({ ok: false, failure: { code: 'not_found', message } });

describe('payer service reads', () => {
  it('searches, finds and names payers within the agency', async () => {
    const { service, queries } = setup(() => [{ ...ROW, total: '1' }]);
    assert.deepEqual(await service.search('t-1', PAGE), {
      ok: true,
      value: { items: [ROW], total: 1, page: 1, pageSize: 25 }
    });
    assert.deepEqual(await service.find('t-1', 'p1'), {
      ok: true,
      value: { payer: { ...ROW, total: '1' } }
    });
    assert.deepEqual(queries[1]?.parameters, ['t-1', 'p1']);
    assert.deepEqual(await service.names('t-1', 'med'), {
      ok: true,
      value: { payers: [{ ...ROW, total: '1' }] }
    });
    assert.deepEqual(queries[2]?.parameters, ['t-1', '%med%', 50]);
  });

  it('reports a payer or payer name outside the agency as not found', async () => {
    const { service, queries } = setup(() => []);
    assert.deepEqual(await service.find('t-1', 'p1'), notFound('Payer not found'));
    assert.deepEqual(await service.remove('t-1', 'p1'), notFound('Payer not found'));
    assert.deepEqual(await service.forget('t-1', 'p1', 'a1'), notFound('Payer name not found'));
    assert.deepEqual(queries[1]?.parameters, ['p1', 't-1']);
    assert.deepEqual(queries[2]?.parameters, ['a1', 'p1', 't-1']);
  });

  it('removes a payer and forgets one of its names', async () => {
    const { service } = setup(() => [{ id: 'x' }]);
    assert.deepEqual(await service.remove('t-1', 'p1'), { ok: true, value: { id: 'p1' } });
    assert.deepEqual(await service.forget('t-1', 'p1', 'a1'), { ok: true, value: { id: 'a1' } });
  });
});

describe('payer service save', () => {
  const saving = (unembedded: boolean, linked: number, e: ReturnType<typeof embedder>) =>
    setup((q) => {
      if (q.sql.startsWith('insert into "payers"')) return [{ ...ROW, unembedded }];
      if (q.sql.startsWith('update "claim_coverages"')) {
        return Array.from({ length: linked }, (_, i) => ({ claim_id: `c${i}` }));
      }
      return [];
    }, e);

  it('links unpaired claim coverages by name and announces the claims', async () => {
    const { service, events, queries } = saving(false, 2, embedder([]));
    assert.deepEqual(await service.save('t-1', INPUT, ALL), {
      ok: true,
      value: { payer: ROW, linkedClaims: 2, embedded: true }
    });
    const link = queries.find((q) => q.sql.startsWith('update "claim_coverages"'));
    assert.deepEqual(link?.parameters, ['p1', 't-1', 'medicare']);
    assert.deepEqual(events, [{ agencyId: 't-1', event: { kind: 'claim', id: null } }]);
  });

  it('announces nothing when no claim was linked', async () => {
    const { service, events } = saving(false, 0, embedder([]));
    assert.deepEqual(await service.save('t-1', INPUT, ALL), {
      ok: true,
      value: { payer: ROW, linkedClaims: 0, embedded: true }
    });
    assert.deepEqual(events, []);
  });

  it('embeds a new or changed payer right away', async () => {
    const fresh = embedder([[0.25, 0.5]]);
    const { service, queries } = saving(true, 0, fresh);
    assert.deepEqual(await service.save('t-1', INPUT, ALL), {
      ok: true,
      value: { payer: ROW, linkedClaims: 0, embedded: true }
    });
    assert.equal(fresh.texts.length, 1);
    const update = queries.find((q) => q.sql.startsWith('update "payers"'));
    assert.ok(update?.sql.endsWith('"embedding" is null'));
    assert.deepEqual(update?.parameters, ['[0.25,0.5]', 'p1', 't-1']);
  });

  it('skips the embedder for a payer whose embedding still holds', async () => {
    const unchanged = embedder([[1]]);
    const { service, queries } = saving(false, 0, unchanged);
    const saved = await service.save('t-1', INPUT, ALL);
    assert.equal(saved.ok && saved.value.embedded, true);
    assert.deepEqual(unchanged.texts, []);
    assert.equal(queries.filter((q) => q.sql.startsWith('update "payers"')).length, 0);
  });

  it('leaves the embedding to the worker when the embedder fails or returns nothing', async () => {
    for (const e of [embedder(new Error('offline')), embedder([])]) {
      const { service, queries } = saving(true, 0, e);
      assert.deepEqual(await service.save('t-1', INPUT, ALL), {
        ok: true,
        value: { payer: ROW, linkedClaims: 0, embedded: false }
      });
      assert.equal(queries.filter((q) => q.sql.startsWith('update "payers"')).length, 0);
    }
  });

  it('adds payers only with create and changes them only with update', async () => {
    const { service, queries, events } = setup(() => []);
    assert.deepEqual(await service.save('t-1', INPUT, { create: false, update: true }), {
      ok: false,
      failure: { code: 'forbidden', message: "You can't add payers" }
    });
    assert.ok(queries.some((q) => q.sql.startsWith('update "payers" set')));
    assert.deepEqual(await service.save('t-1', INPUT, { create: true, update: false }), {
      ok: false,
      failure: { code: 'forbidden', message: "You can't change payers" }
    });
    assert.ok(
      queries.some((q) => q.sql.includes('on conflict (agency_id, lower(name)) do nothing'))
    );
    const before = queries.length;
    assert.deepEqual(await service.save('t-1', INPUT, { create: false, update: false }), {
      ok: false,
      failure: { code: 'forbidden', message: "You can't save payers" }
    });
    assert.equal(queries.length, before);
    assert.equal(queries.filter((q) => q.sql.startsWith('update "claim_coverages"')).length, 0);
    assert.deepEqual(events, []);
  });
});
