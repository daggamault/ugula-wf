import { actionNode, branchNode, type Json, type NodeDef, pin } from '@ugula/graph';
import { attachmentsOf, ENCOUNTER_TYPE, placeCodesOf, toEncounter } from './encounter.ts';
import { parseDataset, pcrNumberOf } from './parse.ts';
import {
  attachmentKey,
  BLOB,
  type BlobLocation,
  type EncounterStore,
  type ReportStore,
  reportKey
} from './reports.ts';

export type NemsisStores = { reports: ReportStore; encounters: EncounterStore };

const CATEGORY = 'Encounter';

const UPLOAD_CONCURRENCY = 16;

const mapLimited = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>
) => {
  const results = new Array<R>(items.length);
  let next = 0;
  const lane = async () => {
    for (let i = next++; i < items.length; i = next++) results[i] = await fn(items[i] as T, i);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
};

const blobOf = (x: { bucket: string | null; key: string | null }): BlobLocation => {
  if (!x.bucket || !x.key) throw new Error('A stored file needs a bucket and key');
  return { bucket: x.bucket, key: x.key };
};

const bytesOf = (base64: string) =>
  Uint8Array.from(atob(base64.replace(/\s+/g, '')), (c) => c.charCodeAt(0));

const ENCOUNTER_PIN = pin('encounter', ENCOUNTER_TYPE, {
  description: 'The encounter, field by field.'
});

const ENCOUNTER_ID = { id: 'encounter' } as const;

const REPORT_ID = { id: 'report' } as const;

const IMPORT_ID = { id: 'import' } as const;

export const createNemsisNodes = (stores: NemsisStores | null): NodeDef[] => {
  const storesOf = () => {
    if (!stores) throw new Error('Encounter nodes need storage, which only the worker provides');
    return stores;
  };
  return [
    actionNode({
      type: 'pcr-file.read',
      title: 'Read PCR File',
      category: CATEGORY,
      description:
        'Reads a NEMSIS 3.4 or 3.5 file, stores each patient care report in it and records them against the import. Give each PCR to Read PCR to get its encounter.',
      level: 'basic',
      keywords: ['import', 'epcr', 'xml', 'nemsis', 'file'],
      effect: true,
      inputs: [
        pin('file', BLOB, { description: 'The stored NEMSIS file.' }),
        pin('importId', IMPORT_ID, {
          optional: true,
          label: 'Import',
          description: 'The import the file arrived with; a new one when empty.'
        })
      ],
      outputs: [
        pin(
          'reports',
          { list: REPORT_ID },
          { label: 'PCRs', description: 'Each patient care report in the file, in file order.' }
        ),
        pin('count', 'integer', {
          label: 'PCR Count',
          description: 'How many patient care reports the file held.'
        })
      ],
      compute: async (inputs, _, ctx) => {
        const { reports } = storesOf();
        const file = blobOf(inputs.file);
        const parsed = parseDataset(await reports.getText(ctx.runId, file)).reports;
        const stored = await mapLimited(parsed, UPLOAD_CONCURRENCY, (report, i) =>
          reports.putJson(ctx.runId, reportKey(file, i), report)
        );
        const ids = await reports.recordReports(
          ctx.runId,
          file,
          inputs.importId,
          stored.map((report, i) => ({ position: i, pcrNumber: pcrNumberOf(parsed[i]), report }))
        );
        return { reports: ids, count: ids.length };
      }
    }),
    actionNode({
      type: 'report.read',
      title: 'Read PCR',
      category: CATEGORY,
      description:
        'Reads one stored patient care report as an encounter, with place codes named and attached files stored on their own.',
      level: 'basic',
      keywords: ['epcr', 'pcr', 'patient care report', 'encounter', 'nemsis'],
      effect: true,
      inputs: [
        pin('report', REPORT_ID, { label: 'PCR', description: 'The stored patient care report.' })
      ],
      outputs: [ENCOUNTER_PIN],
      compute: async (inputs, _, ctx) => {
        const { reports } = storesOf();
        const found = await reports.findReport(ctx.runId, inputs.report);
        if (!found) throw new Error(`PCR ${inputs.report} was not found`);
        const data = await reports.getJson(ctx.runId, found.report);
        const files = await mapLimited(attachmentsOf(data), UPLOAD_CONCURRENCY, (a, i) =>
          reports.putBytes(ctx.runId, attachmentKey(found.report, i), bytesOf(a.data))
        );
        const codes = placeCodesOf(data);
        const names = codes.length ? await reports.findPlaces(codes) : {};
        const locations = files.map(({ bucket, key }) => ({ bucket, key }) as Json);
        return { encounter: { ...toEncounter(data, names, locations), reportId: found.id } };
      }
    }),
    branchNode({
      type: 'encounter.save',
      title: 'Save Encounter',
      category: CATEGORY,
      description:
        'Saves an encounter by its PCR number. The first copy creates it; a changed copy raises its revision; an identical copy changes nothing. Creating emits Encounter Created and revising emits Encounter Revised.',
      level: 'basic',
      keywords: ['store', 'encounter', 'pcr', 'revision', 'upsert'],
      effect: true,
      inputs: [ENCOUNTER_PIN],
      outputs: [
        pin('encounterId', ENCOUNTER_ID, {
          label: 'Encounter',
          description: 'The encounter saved.'
        }),
        pin('revision', 'integer', { description: 'The revision now stored.' })
      ],
      exits: {
        created: { label: 'Created', description: 'The PCR number was new.' },
        revised: { label: 'Revised', description: 'The copy differed from the one stored.' },
        unchanged: { label: 'Unchanged', description: 'The copy matched the one stored.' }
      },
      compute: async ({ encounter }, _, ctx) => {
        const {
          id: _id,
          revision: _revision,
          reportId,
          ...data
        } = encounter as Record<string, Json>;
        const pcrNumber = typeof data.pcrNumber === 'string' ? data.pcrNumber.trim() : '';
        if (!pcrNumber) throw new Error('An encounter needs a PCR number to be saved');
        const saved = await storesOf().encounters.saveEncounter(
          ctx.runId,
          pcrNumber,
          data,
          typeof reportId === 'string' ? reportId : null
        );
        return {
          exit: saved.outcome,
          outputs: { encounterId: saved.id, revision: saved.revision }
        };
      }
    }),
    actionNode({
      type: 'encounter.read',
      title: 'Read Encounter',
      category: CATEGORY,
      description: 'Reads a saved encounter as it stands now.',
      level: 'basic',
      keywords: ['load', 'encounter', 'pcr', 'find'],
      inputs: [
        pin('encounterId', ENCOUNTER_ID, {
          label: 'Encounter',
          description: 'The encounter to read.'
        })
      ],
      outputs: [ENCOUNTER_PIN],
      compute: async ({ encounterId }, _, ctx) => {
        const found = await storesOf().encounters.findEncounter(ctx.runId, encounterId);
        if (!found) throw new Error(`Encounter ${encounterId} was not found`);
        return {
          encounter: {
            ...toEncounter(null),
            ...(found.data as Record<string, Json>),
            id: encounterId,
            revision: found.revision,
            reportId: found.reportId
          }
        };
      }
    })
  ];
};
