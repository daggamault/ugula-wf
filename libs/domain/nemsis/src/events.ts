import type { EventDef, PinSpec } from '@ugula/graph';

export const NEMSIS_EVENTS = {
  pcrFileReceived: 'pcr_file.received',
  encounterCreated: 'encounter.created',
  encounterRevised: 'encounter.revised'
} as const;

const BLOB = { object: { bucket: 'string', key: 'string' } } as const;

const p = (name: string, type: PinSpec['type'], label: string, description: string): PinSpec => ({
  name,
  type,
  label,
  description
});

const ENCOUNTER_ID = p('encounterId', { id: 'encounter' }, 'Encounter', 'The encounter saved.');

const PCR_NUMBER = p('pcrNumber', 'string', 'PCR Number', 'The patient care report number.');

export const nemsisEvents: EventDef[] = [
  {
    type: NEMSIS_EVENTS.pcrFileReceived,
    label: 'PCR File Received',
    description: 'A NEMSIS file of patient care reports was uploaded or arrived over SFTP.',
    payload: [
      p('importId', 'string', 'Import', 'The import the file started.'),
      p('file', BLOB, 'File', 'Where the file is stored.'),
      p('fileName', 'string', 'File Name', 'The name the file arrived with.')
    ]
  },
  {
    type: NEMSIS_EVENTS.encounterCreated,
    label: 'Encounter Created',
    description: 'A patient care report number was saved as an encounter for the first time.',
    payload: [ENCOUNTER_ID, PCR_NUMBER]
  },
  {
    type: NEMSIS_EVENTS.encounterRevised,
    label: 'Encounter Revised',
    description: 'A changed copy of a patient care report was saved over its encounter.',
    payload: [
      ENCOUNTER_ID,
      PCR_NUMBER,
      p('revision', 'integer', 'Revision', 'The revision saved, 2 for the first change.')
    ]
  }
];
