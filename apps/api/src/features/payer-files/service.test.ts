import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunQueueClient } from '@ugula/run-queue';
import type { CompiledQuery } from 'kysely';
import { createPayerFileService, RECEIVE_WORKFLOW } from './service.ts';

const ISA = `ISA*00*${' '.repeat(10)}*00*${' '.repeat(10)}*ZZ*${'CLEARHOUSE'.padEnd(15)}*ZZ*${'METROEMS'.padEnd(15)}*261031*0900*^*00501*000000101*0*P*:~`;

const x12 = (functional: string, version: string, ...segments: string[]) =>
  `${ISA}\nGS*${functional}*CLEARHOUSE*METROEMS*20261031*0900*101*X*${version}~\n${segments.map((s) => `${s}~`).join('\n')}\nGE*1*101~\nIEA*1*000000101~\n`;

const REMITTANCE = x12(
  'HP',
  '005010X221A1',
  'ST*835*0001',
  'BPR*I*600*C*ACH*CCP*01*999999992*DA*123456*1512345678**01*999988880*DA*98765*20261030',
  'TRN*1*EFT0042*1512345678',
  'N1*PR*MEDICARE PART B*XV*DEMOMCR',
  'N1*PE*METRO EMS*XX*1234567893',
  'LX*1',
  'CLP*1001*1*1000*600*150*MB*ICN111',
  'CAS*CO*45*250',
  'CAS*PR*1*150',
  'CLP*9999*1*100*50*0*MB*ICN999',
  'CLP*1001*22*1000*-600*-150*MB*ICN111',
  'SE*11*0001'
);

const CLAIM_ACK = x12(
  'HN',
  '005010X214',
  'ST*277*0001*005010X214',
  'BHT*0085*08*BATCH1*20261031*0900*TH',
  'HL*1**20*1',
  'NM1*AY*2*CLEARHOUSE*****46*CH1',
  'HL*2*1*21*1',
  'NM1*41*2*METRO EMS*****46*METROEMS',
  'HL*3*2*19*1',
  'NM1*85*2*METRO EMS*****XX*1234567893',
  'HL*4*3*PT',
  'NM1*QC*1*DOE*JANE****MI*1EG4TE5MK73',
  'TRN*2*1001',
  'STC*A7:21*20261031*U*1000********Invalid member ID',
  'SE*13*0001'
);

const ELIGIBILITY = x12(
  'HB',
  '005010X279A1',
  'ST*271*0001*005010X279A1',
  'BHT*0022*11*REQ1*20261031*0900',
  'HL*1**20*1',
  'NM1*PR*2*MEDICARE*****PI*DEMOMCR',
  'HL*2*1*21*1',
  'NM1*1P*2*METRO EMS*****XX*1234567893',
  'HL*3*2*22*0',
  'TRN*2*01a16617-7704-7ba6-b9b5-000000000011*9123456789',
  'NM1*IL*1*DOE*JANE****MI*1EG4TE5MK73',
  'EB*6**30',
  'SE*11*0001'
);

const document = { bucket: 'ugula', key: 't1/payer-files/x/era.835', size: 4 };

const setup = ({ imported = false, published = true, failing = false } = {}) => {
  const { db, queries } = createRecordingDb((q: CompiledQuery) => {
    if (q.sql.includes('from "payer_files" as "f"')) {
      return q.parameters.includes('f1') ? [{ id: 'f1', file_name: 'era.835', document }] : [];
    }
    if (q.sql.includes('from "payer_file_items"')) return [{ position: 1, outcome: 'posted' }];
    if (q.sql.startsWith('select "id", "created_at" from "payer_files"')) {
      return imported ? [{ id: 'f0', created_at: new Date('2026-10-01T00:00:00Z') }] : [];
    }
    if (q.sql.includes('select v.version')) return published ? [{ version: 1 }] : [];
    if (q.sql.includes('cross join lateral')) {
      return [{ id: 'v1', key: RECEIVE_WORKFLOW, version: 1, definition: {} }];
    }
    if (q.sql.startsWith('insert into "workflow_runs"')) {
      if (failing) throw new Error('database down');
      return [{ id: 'r1' }];
    }
    return [];
  });
  const boss: RunQueueClient = { insert: async () => undefined };
  const stored: string[] = [];
  const removed: string[] = [];
  const service = createPayerFileService({
    db,
    boss,
    blobs: {
      putBytes: async (key) => {
        stored.push(key);
        return { bucket: 'ugula', key, size: 1, contentType: 'application/edi-x12' };
      },
      getBytes: async () => new TextEncoder().encode(REMITTANCE),
      remove: async (ref) => void removed.push(ref.key)
    },
    maxBytes: 1_000_000
  });
  return { service, queries, stored, removed };
};

const upload = (service: ReturnType<typeof setup>['service'], text: string, name = 'era.835') =>
  service.upload('t1', 'u1', { name, type: '', bytes: new TextEncoder().encode(text) });

describe('payer file service', () => {
  it('stores an upload and starts Receive Payer File for it, like the clearinghouse poll', async () => {
    const { service, queries, stored } = setup();
    assert.deepEqual(await upload(service, REMITTANCE), {
      ok: true,
      value: { runId: 'r1', kind: '835' }
    });
    assert.match(stored[0] ?? '', /payer-files\/.+\/era\.835$/);
    const run = queries.find((q) => q.sql.startsWith('insert into "workflow_runs"'));
    assert.ok(run?.parameters.includes('t1') && run.parameters.includes('u1'));
    assert.ok(run?.parameters.some((p) => String(p).includes('"fileName":"era.835"')));
    assert.ok(queries.some((q) => q.sql.includes('insert into workflow_run_graphs')));
    assert.ok(!queries.some((q) => q.sql.startsWith('insert into "payer_files"')));
  });

  it('drops the stored file when its run cannot start', async () => {
    const { service, stored, removed } = setup({ failing: true });
    await assert.rejects(() => upload(service, REMITTANCE), /database down/);
    assert.equal(stored.length, 1);
    assert.deepEqual(removed, stored);
  });

  it('reads acknowledgments and eligibility files before starting their run', async () => {
    const { service } = setup();
    const ack = await upload(service, CLAIM_ACK, 'ack.277');
    assert.equal(ack.ok && ack.value.kind, '277');
    const elig = await upload(service, ELIGIBILITY, 'elig.271');
    assert.equal(elig.ok && elig.value.kind, '271');
  });

  it('refuses files that are not inbound X12 or were already imported', async () => {
    const { service, stored } = setup();
    const bad = await upload(service, 'not edi');
    assert.equal(bad.ok ? null : bad.failure.code, 'invalid');
    assert.equal(((await upload(service, '')) as { ok: boolean }).ok, false);
    const again = await upload(setup({ imported: true }).service, REMITTANCE);
    assert.equal(again.ok ? null : again.failure.code, 'conflict');
    assert.match(again.ok ? '' : again.failure.message, /already imported on 2026-10-01/);
    assert.equal(stored.length, 0);
  });

  it('refuses an upload when the workflow is not published', async () => {
    const { service, stored } = setup({ published: false });
    const res = await upload(service, REMITTANCE);
    assert.equal(res.ok ? null : res.failure.code, 'conflict');
    assert.match(res.ok ? '' : res.failure.message, /billing\.receive-payer-file workflow/);
    assert.equal(stored.length, 0);
  });

  it('lists, finds and downloads files of the agency only', async () => {
    const { service, queries } = setup();
    await service.list('t1', { page: 1, pageSize: 25, sort: 'received', dir: 'desc' });
    assert.ok(queries[0]?.sql.includes('"f"."agency_id" = $1'));
    const missing = await service.find('t1', 'f9');
    assert.equal(missing.ok ? null : missing.failure.code, 'not_found');
    const gone = await service.download('t1', 'f9');
    assert.equal(gone.ok ? null : gone.failure.code, 'not_found');
  });

  it('opens a file with its items without exposing where it is stored', async () => {
    const { service, queries } = setup();
    assert.deepEqual(await service.find('t1', 'f1'), {
      ok: true,
      value: {
        file: { id: 'f1', file_name: 'era.835' },
        items: [{ position: 1, outcome: 'posted' }]
      }
    });
    assert.deepEqual(queries[0]?.parameters, ['t1', 'f1']);
    assert.deepEqual(queries[1]?.parameters, ['f1']);
    assert.deepEqual(await service.download('t1', 'f1'), {
      ok: true,
      value: { name: 'era.835', bytes: new TextEncoder().encode(REMITTANCE) }
    });
  });

  it('refuses files over the size limit before reading or storing them', async () => {
    const { service, queries, stored } = setup();
    const big = await service.upload('t1', 'u1', {
      name: 'era.835',
      type: '',
      bytes: new Uint8Array(1_000_001)
    });
    assert.equal(big.ok ? null : big.failure.code, 'invalid');
    assert.equal(queries.length, 0);
    assert.equal(stored.length, 0);
  });
});
