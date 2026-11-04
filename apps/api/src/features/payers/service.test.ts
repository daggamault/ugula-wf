import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { recordAnnouncements } from '../../shared/testing.ts';
import { createPayerService } from './service.ts';

const PAGE = { page: 1, pageSize: 25, sort: 'name', dir: 'asc' } as const;

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

describe('payer service', () => {
  it('searches, finds and saves payers and reports unknown deletes', async () => {
    const row = { id: 'p1', name: 'Medicare', payer_id: '00952', claim_filing: 'MB' };
    const { db } = createRecordingDb((q) =>
      q.sql.startsWith('delete') ? [] : [{ ...row, total: '1' }]
    );
    const { announce, events } = recordAnnouncements();
    const service = createPayerService({ db, announce, embedder: embedder([[0.5]]) });
    assert.deepEqual(await service.search('t-1', PAGE), {
      ok: true,
      value: { items: [row], total: 1, page: 1, pageSize: 25 }
    });
    assert.equal((await service.find('t-1', 'p1')).ok, true);
    assert.equal((await service.names('t-1')).ok, true);
    const saved = await service.save('t-1', {
      name: 'Medicare',
      payerId: '00952',
      claimFiling: 'MB',
      filingLimitDays: null
    });
    assert.equal(saved.ok && saved.value.linkedClaims, 1);
    assert.deepEqual(events, [{ agencyId: 't-1', event: { kind: 'claim', id: null } }]);
    const removed = await service.remove('t-1', 'p1');
    assert.equal(!removed.ok && removed.failure.code, 'not_found');
    const forgotten = await service.forget('t-1', 'p1', 'a1');
    assert.equal(!forgotten.ok && forgotten.failure.code, 'not_found');
  });

  it('embeds a new or changed payer right away and leaves it to the worker when that fails', async () => {
    const input = {
      name: 'Medicare',
      payerId: '00952',
      claimFiling: 'MB',
      filingLimitDays: null
    } as const;
    const setup = (unembedded: boolean, e: ReturnType<typeof embedder>) => {
      const { db, queries } = createRecordingDb((q) =>
        q.sql.startsWith('insert into "payers"') ? [{ id: 'p1', name: 'Medicare', unembedded }] : []
      );
      return {
        queries,
        service: createPayerService({ db, announce: recordAnnouncements().announce, embedder: e })
      };
    };
    const fresh = embedder([[0.25, 0.5]]);
    const created = setup(true, fresh);
    const saved = await created.service.save('t-1', input);
    assert.deepEqual(saved.ok && saved.value, {
      payer: { id: 'p1', name: 'Medicare' },
      linkedClaims: 0,
      embedded: true
    });
    assert.equal(fresh.texts.length, 1);
    const update = created.queries.find((q) => q.sql.startsWith('update "payers"'));
    assert.ok(update?.sql.includes('"embedding" is null'));
    assert.deepEqual(update?.parameters, ['[0.25,0.5]', 'p1', 't-1']);

    const unchanged = embedder([[1]]);
    const kept = await setup(false, unchanged).service.save('t-1', input);
    assert.equal(kept.ok && kept.value.embedded, true);
    assert.equal(unchanged.texts.length, 0);

    const down = await setup(true, embedder(new Error('offline'))).service.save('t-1', input);
    assert.equal(down.ok && down.value.embedded, false);
  });

  it('reports a payer outside the agency as not found', async () => {
    const { db } = createRecordingDb(() => []);
    const service = createPayerService({
      db,
      announce: recordAnnouncements().announce,
      embedder: embedder([])
    });
    const found = await service.find('t-1', 'p1');
    assert.equal(!found.ok && found.failure.code, 'not_found');
  });
});
