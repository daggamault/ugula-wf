import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createNemsisNodes,
  type ReportStore,
  reportKey,
  type SplitReport,
  UPLOAD_CONCURRENCY
} from './nodes.ts';

const SAMPLE = `<EMSDataSet xmlns="http://www.nemsis.org"><Header>
  <PatientCareReport><eRecord><eRecord.01>A</eRecord.01></eRecord></PatientCareReport>
  <PatientCareReport><eRecord><eRecord.01>B</eRecord.01></eRecord></PatientCareReport>
</Header></EMSDataSet>`;

const memoryStore = () => {
  const blobs = new Map<string, unknown>([['in/file.xml', SAMPLE]]);
  const recorded: { file: string; reports: SplitReport[] }[] = [];
  const store: ReportStore = {
    getText: async (_, { key }) => String(blobs.get(key)),
    getJson: async (_, { key }) => blobs.get(key),
    putJson: async (_, key, value) => {
      blobs.set(key, value);
      return { bucket: 'ugula', key, size: 1, contentType: 'application/json' };
    },
    recordReports: async (_, file, reports) => {
      recorded.push({ file: file.key, reports });
    }
  };
  return { store, blobs, recorded };
};

const invoke = (values: Record<string, unknown>) => ({
  read: async (pin: string) => values[pin] ?? null,
  ctx: { runId: 'r1' }
});

describe('createNemsisNodes', () => {
  it('splits a file into one stored report per patient care report', async () => {
    const { store, blobs, recorded } = memoryStore();
    const [split, readReport] = createNemsisNodes(store);
    const file = { bucket: 'ugula', key: 'in/file.xml' };
    const res = await split?.run(invoke({ file }));
    assert.equal(res?.outputs.count, 2);
    assert.deepEqual(
      ((res?.outputs.reports ?? []) as { key: string }[]).map((r) => r.key),
      [reportKey(file, 0), reportKey(file, 1)]
    );
    assert.equal(reportKey(file, 1), 'in/file.xml.reports/00001.json');
    const loaded = await readReport?.run(
      invoke({ report: { bucket: 'ugula', key: reportKey(file, 1) } })
    );
    assert.deepEqual(loaded?.outputs.data, { eRecord: { 'eRecord.01': 'B' } });
    assert.equal(blobs.size, 3);
    assert.deepEqual(
      recorded.map((r) => [r.file, r.reports.map((x) => [x.position, x.pcrNumber, x.report.key])]),
      [
        [
          'in/file.xml',
          [
            [0, 'A', reportKey(file, 0)],
            [1, 'B', reportKey(file, 1)]
          ]
        ]
      ]
    );
  });

  it('stores large files in order with a bounded number of uploads in flight', async () => {
    const { store, blobs } = memoryStore();
    const total = UPLOAD_CONCURRENCY * 3 + 1;
    blobs.set(
      'in/big.xml',
      `<EMSDataSet><Header>${'<PatientCareReport/>'.repeat(total)}</Header></EMSDataSet>`
    );
    let active = 0;
    let peak = 0;
    const [split] = createNemsisNodes({
      ...store,
      putJson: async (runId, key, value) => {
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setImmediate(resolve));
        active--;
        return store.putJson(runId, key, value);
      }
    });
    const file = { bucket: 'ugula', key: 'in/big.xml' };
    const res = await split?.run(invoke({ file }));
    assert.equal(peak, UPLOAD_CONCURRENCY);
    assert.deepEqual(
      ((res?.outputs.reports ?? []) as { key: string }[]).map((r) => r.key),
      Array.from({ length: total }, (_, i) => reportKey(file, i))
    );
  });

  it('describes static signatures so other apps can validate graphs without storage', async () => {
    const nodes = createNemsisNodes(null);
    assert.deepEqual(
      nodes.map((n) => `${n.type}@${n.version}`),
      ['nemsis.split@1', 'nemsis.read-report@1']
    );
    assert.deepEqual(nodes[0]?.signature.execOut, ['then']);
    await assert.rejects(
      () => nodes[0]?.run(invoke({})) ?? Promise.resolve(),
      /only the worker provides/
    );
  });
});
