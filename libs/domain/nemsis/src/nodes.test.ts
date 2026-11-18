import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Json, type NodeDef, nodeDocumentationIssues, type Values } from '@ugula/graph';
import { invokeNode } from '@ugula/graph/testing';
import { createNemsisNodes } from './nodes.ts';
import type { EncounterStore, ReportStore } from './reports.ts';

type SplitReport = Parameters<ReportStore['recordReports']>[3][number];

const SAMPLE = `<EMSDataSet xmlns="http://www.nemsis.org"><Header>
  <PatientCareReport><eRecord><eRecord.01>A</eRecord.01></eRecord></PatientCareReport>
  <PatientCareReport>
    <eRecord><eRecord.01>B</eRecord.01></eRecord>
    <eScene><eScene.17>1215209</eScene.17></eScene>
    <eOther><eOther.FileGroup><eOther.11>SGk=</eOther.11><eOther.22>pcs.pdf</eOther.22></eOther.FileGroup></eOther>
  </PatientCareReport>
</Header></EMSDataSet>`;

const blob = (key: string) => ({ bucket: 'ugula', key, size: 1, contentType: 'x' });

const memoryReports = () => {
  const blobs = new Map<string, unknown>([['in/file.xml', SAMPLE]]);
  const recorded: { importId: string | null; reports: SplitReport[] }[] = [];
  const store: ReportStore = {
    getText: async (_, { key }) => String(blobs.get(key)),
    getJson: async (_, { key }) => blobs.get(key),
    putJson: async (_, key, value) => {
      blobs.set(key, value);
      return blob(key);
    },
    putBytes: async (_, key, bytes) => {
      blobs.set(key, new TextDecoder().decode(bytes));
      return blob(key);
    },
    recordReports: async (_, _file, importId, reports) => {
      recorded.push({ importId, reports });
      return reports.map((r) => `report-${r.position}`);
    },
    findReport: async (_, id) => {
      const position = Number(id.split('-')[1]);
      const report = recorded[0]?.reports[position]?.report;
      return report ? { id, report } : null;
    },
    findPlaces: async (codes) => (codes.includes('1215209') ? { '1215209': 'Erie' } : {})
  };
  return { store, blobs, recorded };
};

const memoryEncounters = () => {
  const rows = new Map<
    string,
    { id: string; revision: number; data: string; reportId: string | null }
  >();
  const store: EncounterStore = {
    saveEncounter: async (_, pcrNumber, data, reportId) => {
      const text = JSON.stringify(data);
      const found = rows.get(pcrNumber);
      if (!found) {
        rows.set(pcrNumber, { id: `e-${pcrNumber}`, revision: 1, data: text, reportId });
        return { id: `e-${pcrNumber}`, revision: 1, outcome: 'created' };
      }
      if (found.data === text)
        return { id: found.id, revision: found.revision, outcome: 'unchanged' };
      Object.assign(found, { revision: found.revision + 1, data: text, reportId });
      return { id: found.id, revision: found.revision, outcome: 'revised' };
    },
    findEncounter: async (_, id) => {
      const found = [...rows.values()].find((r) => r.id === id);
      return found
        ? {
            revision: found.revision,
            reportId: found.reportId,
            data: JSON.parse(found.data) as Json
          }
        : null;
    }
  };
  return store;
};

const nodesOf = () => {
  const reports = memoryReports();
  const [readFile, readPcr, save, read] = createNemsisNodes({
    reports: reports.store,
    encounters: memoryEncounters()
  });
  return { ...reports, readFile, readPcr, save, read };
};

const run = (node: NodeDef | undefined, inputs: Values) => {
  if (!node) throw new Error('No such node');
  return invokeNode(node, { inputs });
};

describe('createNemsisNodes', () => {
  it('documents every pin as a basic node', () => {
    const nodes = createNemsisNodes(null);
    assert.deepEqual(nodes.flatMap(nodeDocumentationIssues), []);
    assert.deepEqual(new Set(nodes.map((n) => n.level)), new Set(['basic']));
  });

  it('stores each report of a file and records them against the import', async () => {
    const { readFile, recorded, blobs } = nodesOf();
    const res = await run(readFile, {
      file: { bucket: 'ugula', key: 'in/file.xml' },
      importId: 'i-1'
    });
    assert.deepEqual(res.outputs, { reports: ['report-0', 'report-1'], count: 2 });
    assert.deepEqual(
      recorded.map((r) => [
        r.importId,
        r.reports.map((x) => [x.position, x.pcrNumber, x.report.key])
      ]),
      [
        [
          'i-1',
          [
            [0, 'A', 'in/file.xml.reports/00000.json'],
            [1, 'B', 'in/file.xml.reports/00001.json']
          ]
        ]
      ]
    );
    assert.equal(blobs.size, 3);
  });

  it('reads a report as an encounter, naming places and storing attached files', async () => {
    const { readFile, readPcr, blobs } = nodesOf();
    await run(readFile, { file: { bucket: 'ugula', key: 'in/file.xml' } });
    const { outputs } = await run(readPcr, { report: 'report-1' });
    const encounter = outputs.encounter as Record<string, Json>;
    assert.deepEqual([encounter.pcrNumber, encounter.reportId], ['B', 'report-1']);
    assert.equal(
      ((encounter.pickup as Record<string, Json>).address as Record<string, Json>).city,
      'Erie'
    );
    const key = 'in/file.xml.reports/00001.json.files/000';
    assert.deepEqual(encounter.attachments, [
      { documentType: null, fileType: null, name: 'pcs.pdf', file: { bucket: 'ugula', key } }
    ]);
    assert.equal(blobs.get(key), 'Hi');
    await assert.rejects(run(readPcr, { report: 'report-9' }), /PCR report-9 was not found/);
  });

  it('saves an encounter once, revises it when it changes and leaves it when it does not', async () => {
    const { readFile, readPcr, save, read } = nodesOf();
    await run(readFile, { file: { bucket: 'ugula', key: 'in/file.xml' } });
    const encounter = (await run(readPcr, { report: 'report-0' })).outputs.encounter ?? null;
    const first = await invokeNode(save as NodeDef, { inputs: { encounter } });
    assert.deepEqual([first.pin, first.outputs], ['created', { encounterId: 'e-A', revision: 1 }]);
    const again = await invokeNode(save as NodeDef, {
      inputs: { encounter: { ...(encounter as object), reportId: 'report-5' } }
    });
    assert.equal(again.pin, 'unchanged');
    const changed = await invokeNode(save as NodeDef, {
      inputs: { encounter: { ...(encounter as object), narrative: 'Revised.' } }
    });
    assert.deepEqual([changed.pin, changed.outputs.revision], ['revised', 2]);
    const stored = (await run(read, { encounterId: 'e-A' })).outputs.encounter as Record<
      string,
      Json
    >;
    assert.deepEqual(
      [stored.id, stored.revision, stored.reportId, stored.narrative],
      ['e-A', 2, 'report-0', 'Revised.']
    );
  });

  it('refuses to save an encounter without a PCR number or read one that is missing', async () => {
    const { save, read } = nodesOf();
    await assert.rejects(run(save, { encounter: { pcrNumber: ' ' } }), /needs a PCR number/);
    await assert.rejects(run(read, { encounterId: 'e-Z' }), /e-Z was not found/);
  });
});
