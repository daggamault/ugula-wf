import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import { asStage, asWorkflow, d, exit, flow, stage, T } from './shared.ts';

const REPORT = { id: 'report' } as const;

const ENCOUNTER_ID = { id: 'encounter' } as const;

const savePcr = (): GraphDef => {
  const g = stage(
    [d('report', REPORT, 'Report', 'A patient care report stored from a PCR file.')],
    [d('encounterId', ENCOUNTER_ID, 'Encounter', 'The encounter the report was saved as.')],
    {
      created: exit('Created', 'The report was a new PCR number, saved as a new encounter.'),
      revised: exit('Revised', 'The report changed an encounter already saved.'),
      unchanged: exit('Unchanged', 'The report matched the encounter already saved.')
    }
  );
  g.add('read', 'encounter.read-pcr', { label: 'Read the Report' });
  g.add('save', 'encounter.save', { label: 'Save the Encounter' });
  g.ret('created', 'created');
  g.ret('revised', 'revised');
  g.ret('unchanged', 'unchanged');
  g.wire('entry.exec', 'read.exec');
  g.wire('entry.report', 'read.report');
  g.wire('read.then', 'save.exec');
  g.wire('read.encounter', 'save.encounter');
  for (const outcome of ['created', 'revised', 'unchanged']) {
    g.wire(`save.${outcome}`, `${outcome}.exec`);
    g.wire('save.encounterId', `${outcome}.encounterId`);
  }
  return g.def;
};

const COUNTS = ['created', 'revised', 'unchanged', 'failed'] as const;

const COUNT_LABELS: Record<(typeof COUNTS)[number], [string, string]> = {
  created: ['New Encounters', 'Reports saved as new encounters.'],
  revised: ['Revised Encounters', 'Reports that changed an encounter already saved.'],
  unchanged: ['Unchanged', 'Reports identical to the encounter already saved.'],
  failed: ['Failed', 'Reports that could not be read or saved; their runs say why.']
};

const importPcrFile = (): GraphDef => {
  const g = flow(
    [
      d('importId', 'string', 'Import', 'The import the file arrived with.', true),
      d('file', T.blob, 'File', 'Where the NEMSIS file is stored.'),
      d('fileName', 'string', 'File Name', 'The name the file arrived with.', true)
    ],
    [
      d('reports', 'integer', 'Reports', 'How many patient care reports the file held.'),
      ...COUNTS.map((c) => d(c, 'integer', ...COUNT_LABELS[c]))
    ],
    COUNTS.map((name) => ({ name, type: 'integer', default: 0 }))
  );
  g.trigger({ kind: 'event', event: 'pcr_file.received', where: {} });
  g.add('read', 'encounter.read-pcr-file', { label: 'Read the PCR File' });
  g.add('each', 'std.flow.for-each', { label: 'Each Report' });
  g.add('try', 'std.flow.try', { label: 'Save It, or Count It as Failed' });
  g.add('save', 'billing.save-pcr', { label: 'Save the PCR' });
  for (const c of COUNTS) {
    g.add(`count${c}`, 'std.var.increment', {
      label: `Count ${COUNT_LABELS[c][0]}`,
      config: { name: c }
    });
    g.add(`get${c}`, 'std.var.get', { label: COUNT_LABELS[c][0], config: { name: c } });
  }
  g.ret('done');
  g.wire('entry.exec', 'read.exec');
  g.wire('entry.file', 'read.file');
  g.wire('entry.importId', 'read.importId');
  g.wire('read.then', 'each.exec');
  g.wire('read.reports', 'each.list');
  g.wire('each.body', 'try.exec');
  g.wire('try.try', 'save.exec');
  g.wire('each.item', 'save.report');
  g.wire('save.created', 'countcreated.exec');
  g.wire('save.revised', 'countrevised.exec');
  g.wire('save.unchanged', 'countunchanged.exec');
  g.wire('try.catch', 'countfailed.exec');
  g.wire('each.completed', 'done.exec');
  g.wire('read.count', 'done.reports');
  for (const c of COUNTS) g.wire(`get${c}.value`, `done.${c}`);
  return g.def;
};

export const importGraphs: SeedGraph[] = [
  asStage(
    'billing.save-pcr',
    'Save PCR',
    'Reads one stored patient care report as an encounter and saves it by its PCR number: new, revised or unchanged.',
    savePcr()
  ),
  asWorkflow(
    'billing.import-pcr-file',
    'Import PCR File',
    'When a NEMSIS file arrives, reads every patient care report in it and saves each as an encounter. A report that cannot be saved is counted as failed and the rest go on. Saving a new encounter starts Encounter to Claim; saving a changed one starts Encounter Revised.',
    importPcrFile()
  )
];
