import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunQueueClient } from '@ugula/run-queue';
import type { CompiledQuery } from 'kysely';
import { recordAnnouncements } from '../../shared/testing.ts';
import { createPayerFileService } from './service.ts';

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

const setup = ({ imported = false } = {}) => {
  const { db, queries } = createRecordingDb((q: CompiledQuery) => {
    if (q.sql.includes('from "payer_files" as "f"')) {
      return q.parameters.includes('f1') ? [{ id: 'f1', file_name: 'era.835', document }] : [];
    }
    if (q.sql.includes('from "payer_file_items"')) return [{ position: 1, outcome: 'posted' }];
    if (q.sql.startsWith('select "id", "created_at" from "payer_files"')) {
      return imported ? [{ id: 'f0', created_at: new Date('2026-10-01T00:00:00Z') }] : [];
    }
    if (q.sql.startsWith('insert into "payer_files"')) return [{ id: 'f1' }];
    if (q.sql.startsWith('select "id", "status" from "claims"')) {
      return q.parameters.includes(1001) ? [{ id: 'c1', status: 'submitted' }] : [];
    }
    if (q.sql.endsWith('for update')) return [{ id: 'c1', status: 'submitted', patient_id: 'p1' }];
    if (q.sql.startsWith('select "cc"."id"')) {
      return [{ id: 'cov1', payer: 'Medicare', payerId: 'DEMOMCR', has_events: true }];
    }
    if (q.sql.includes('from "claim_balances"')) return [{ balance_cents: 100_000 }];
    if (q.sql.startsWith('select "coverage_id" from "claim_events"')) {
      return [{ coverage_id: 'cov1' }];
    }
    if (q.sql.startsWith('insert into "claim_events"')) return [{ id: 'e1' }];
    if (q.sql.startsWith('select "id", "claim_id" from "claim_coverages"')) {
      return [{ id: 'cov1', claim_id: 'c1' }];
    }
    return [];
  });
  const boss: RunQueueClient = { insert: async () => undefined };
  const { announce, events } = recordAnnouncements();
  const stored: string[] = [];
  const service = createPayerFileService({
    db,
    boss,
    blobs: {
      putBytes: async (key) => {
        stored.push(key);
        return { bucket: 'ugula', key, size: 1, contentType: 'application/edi-x12' };
      },
      getBytes: async () => new TextEncoder().encode(REMITTANCE)
    },
    announce,
    now: () => new Date('2026-10-31T12:00:00Z'),
    maxBytes: 1_000_000
  });
  return { service, queries, events, stored };
};

const upload = (service: ReturnType<typeof setup>['service'], text: string, name = 'era.835') =>
  service.upload('t1', 'u1', { name, type: '', bytes: new TextEncoder().encode(text) });

const items = (queries: CompiledQuery[]) =>
  queries.find((q) => q.sql.startsWith('insert into "payer_file_items"'))?.parameters ?? [];

describe('payer file service', () => {
  it('posts remittance payments, leaving unknown claims and reversals to a biller', async () => {
    const { service, queries, events, stored } = setup();
    assert.deepEqual(await upload(service, REMITTANCE), {
      ok: true,
      value: { id: 'f1', kind: '835', items: 3, problems: 2 }
    });
    assert.match(stored[0] ?? '', /payer-files\/.+\/era\.835$/);
    const payment = queries.find((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.deepEqual(payment?.parameters.slice(0, 8), [
      'c1',
      'response',
      'cov1',
      60_000,
      25_000,
      'ICN111',
      '2026-10-30',
      'EFT0042'
    ]);
    assert.ok(
      queries.some(
        (q) =>
          q.sql.startsWith('insert into "claim_event_adjustments"') &&
          q.parameters.includes('PR') &&
          q.parameters.includes(15_000)
      )
    );
    const recorded = items(queries);
    assert.ok(recorded.includes('posted'));
    assert.ok(recorded.includes('unmatched'));
    assert.ok(recorded.includes('review'));
    assert.deepEqual(events, [{ tenantId: 't1', event: { kind: 'claim', id: 'c1' } }]);
  });

  it('refuses files that are not inbound X12 or were already imported', async () => {
    const { service } = setup();
    const bad = await upload(service, 'not edi');
    assert.equal(bad.ok ? null : bad.failure.code, 'invalid');
    assert.equal(((await upload(service, '')) as { ok: boolean }).ok, false);
    const again = await upload(setup({ imported: true }).service, REMITTANCE);
    assert.equal(again.ok ? null : again.failure.code, 'conflict');
    assert.match(again.ok ? '' : again.failure.message, /already imported on 2026-10-01/);
  });

  it('records a 277CA rejection on the submitted payer so the claim is reviewed again', async () => {
    const { service, queries } = setup();
    const result = await upload(service, CLAIM_ACK, 'ack.277');
    assert.deepEqual(result.ok && result.value.problems, 1);
    const rejection = queries.find((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.ok(rejection?.parameters.includes('rejected'));
    assert.ok(rejection?.parameters.some((p) => String(p).includes('Invalid member ID')));
  });

  it('saves eligibility on the coverage a 271 traces back to', async () => {
    const { service, queries } = setup();
    const result = await upload(service, ELIGIBILITY, 'elig.271');
    assert.deepEqual(result.ok && result.value, { id: 'f1', kind: '271', items: 1, problems: 1 });
    const saved = queries.find((q) => q.sql.startsWith('update "claim_coverages"'));
    assert.ok(saved?.parameters.includes('inactive'));
    assert.ok(items(queries).includes('ineligible'));
  });

  it('lists, finds and downloads files of the tenant only', async () => {
    const { service, queries } = setup();
    await service.list('t1', { page: 1, pageSize: 25, sort: 'received', dir: 'desc' });
    assert.ok(queries[0]?.sql.includes('"f"."tenant_id" = $1'));
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
