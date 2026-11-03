import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NodeDef, Values } from '@ugula/graph';
import { invokeNode } from '@ugula/graph/testing';
import { createNemsisNodes, type ReportStore, reportKey } from './nodes.ts';

type SplitReport = Parameters<ReportStore['recordReports']>[2][number];

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
    },
    findPlaces: async (codes) => (codes.includes('1215209') ? { '1215209': 'Erie' } : {})
  };
  return { store, blobs, recorded };
};

const run = (node: NodeDef | undefined, inputs: Values) => {
  if (!node) throw new Error('No such node');
  return invokeNode(node, { inputs });
};

describe('createNemsisNodes', () => {
  it('splits a file into one stored report per patient care report', async () => {
    const { store, blobs, recorded } = memoryStore();
    const [split, readReport] = createNemsisNodes(store);
    const file = { bucket: 'ugula', key: 'in/file.xml' };
    const res = await run(split, { file });
    assert.equal(res.outputs.count, 2);
    assert.deepEqual(
      ((res.outputs.reports ?? []) as { key: string }[]).map((r) => r.key),
      [reportKey(file, 0), reportKey(file, 1)]
    );
    assert.equal(reportKey(file, 1), 'in/file.xml.reports/00001.json');
    const loaded = await run(readReport, { report: { bucket: 'ugula', key: reportKey(file, 1) } });
    assert.deepEqual(Object.keys(loaded.outputs), ['pcr']);
    assert.equal((loaded.outputs.pcr as { pcrNumber: string }).pcrNumber, 'B');
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
    const total = 49;
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
    const res = await run(split, { file });
    assert.ok(peak > 1 && peak < total);
    assert.deepEqual(
      ((res.outputs.reports ?? []) as { key: string }[]).map((r) => r.key),
      Array.from({ length: total }, (_, i) => reportKey(file, i))
    );
  });

  it('reads a report with its GNIS city codes resolved to place names', async () => {
    const { store, blobs } = memoryStore();
    blobs.set('r.json', {
      ePatient: { 'ePatient.06': '1215209' },
      eScene: { 'eScene.17': 'Fairview' },
      eDisposition: { 'eDisposition.04': '999' }
    });
    const [, readReport] = createNemsisNodes(store);
    const res = await run(readReport, { report: { bucket: 'ugula', key: 'r.json' } });
    const pcr = res.outputs.pcr as Record<string, Record<string, unknown>>;
    assert.deepEqual([pcr.patient?.city, pcr.patient?.cityCode], ['Erie', '1215209']);
    assert.deepEqual([pcr.scene?.city, pcr.scene?.cityCode], ['Fairview', null]);
    assert.deepEqual([pcr.disposition?.city, pcr.disposition?.cityCode], [null, '999']);
  });

  it('describes static signatures so other apps can validate graphs without storage', async () => {
    const nodes = createNemsisNodes(null);
    assert.deepEqual(
      nodes.map((n) => `${n.type}@${n.version}`),
      ['nemsis.split@1', 'nemsis.read-report@1']
    );
    await assert.rejects(
      () => run(nodes[0], { file: { bucket: 'ugula', key: 'in/file.xml' } }),
      /only the worker provides/
    );
    await assert.rejects(
      () => run(nodes[0], {}),
      /Input "file" of "Split NEMSIS File" is required/
    );
  });
});
