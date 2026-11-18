import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import { asStage, asWorkflow, d, exit, flow, ID, stage, T } from './shared.ts';

const OUTCOMES = ['created', 'revised', 'unchanged'] as const;

const savePcr = (): GraphDef => {
  const g = stage(
    [d('report', ID.report, 'PCR', 'A patient care report stored from a PCR file.')],
    [d('encounterId', ID.encounter, 'Encounter', 'The encounter the report was saved as.')],
    {
      created: exit('Created', 'The report was a new PCR number, saved as a new encounter.'),
      revised: exit('Revised', 'The report changed an encounter already saved.'),
      unchanged: exit('Unchanged', 'The report matched the encounter already saved.')
    }
  );
  g.add('read', 'report.read', { label: 'Read PCR' });
  g.add('save', 'encounter.save', { label: 'Save Encounter' });
  g.wire('entry.exec', 'read.exec');
  g.wire('entry.report', 'read.report');
  g.wire('read.then', 'save.exec');
  g.wire('read.encounter', 'save.encounter');
  for (const outcome of OUTCOMES) {
    g.ret(outcome, outcome);
    g.wire(`save.${outcome}`, `${outcome}.exec`);
    g.wire('save.encounterId', `${outcome}.encounterId`);
  }
  return g.def;
};

const COUNTS = {
  created: ['New Encounters', 'Reports saved as new encounters.'],
  revised: ['Revised Encounters', 'Reports that changed an encounter already saved.'],
  unchanged: ['Unchanged', 'Reports identical to the encounter already saved.'],
  failed: ['Failed', 'Reports that could not be read or saved; the run says why.']
} as const;

const counted = Object.keys(COUNTS) as (keyof typeof COUNTS)[];

const capital = (name: string) => `${name[0]?.toUpperCase()}${name.slice(1)}`;

const importPcrFile = (): GraphDef => {
  const g = flow(
    [
      d(
        'importId',
        ID.import,
        'Import',
        'The import the file arrived with; a new one when empty.',
        true
      ),
      d('file', T.blob, 'File', 'Where the NEMSIS file is stored.')
    ],
    [
      d('reports', 'integer', 'PCRs', 'How many patient care reports the file held.'),
      ...counted.map((c) => d(c, 'integer', COUNTS[c][0], COUNTS[c][1]))
    ],
    counted.map((name) => ({ name, type: 'integer', default: 0 }))
  );
  g.trigger({ kind: 'event', event: 'pcr_file.received', where: {} });
  g.add('read', 'pcr-file.read', { label: 'Read PCR File' });
  g.add('each', 'std.flow.for-each', { label: 'Each PCR' });
  g.add('try', 'std.flow.try', { label: 'Save It, or Count It as Failed' });
  g.add('save', 'billing.save-pcr', { label: 'Save PCR' });
  for (const c of counted) {
    g.add(`count${capital(c)}`, 'std.var.increment', {
      label: `Count ${COUNTS[c][0]}`,
      config: { name: c }
    });
    g.add(c, 'std.var.get', { label: COUNTS[c][0], config: { name: c } });
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
  for (const outcome of OUTCOMES) g.wire(`save.${outcome}`, `count${capital(outcome)}.exec`);
  g.wire('try.catch', 'countFailed.exec');
  g.wire('each.completed', 'done.exec');
  g.wire('read.count', 'done.reports');
  for (const c of counted) g.wire(`${c}.value`, `done.${c}`);
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
    'When a NEMSIS file arrives, reads every patient care report in it and saves each as an encounter. A report that cannot be saved is counted as failed and the rest go on. Saving a new encounter starts Encounter to Claim; saving a changed one starts Revised Encounter to Claim.',
    importPcrFile()
  )
];
