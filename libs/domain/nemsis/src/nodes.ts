import { actionNode, type Json, type NodeDef, pin } from '@ugula/graph';
import { parseDataset, pcrNumberOf } from './parse.ts';
import { PCR_TYPE, placeCodes, resolvePlaces, toPcr } from './pcr.ts';

type BlobLocation = { bucket: string; key: string };

type StoredBlob = BlobLocation & { size: number; contentType: string };

type SplitReport = { position: number; pcrNumber: string | null; report: StoredBlob };

export type ReportStore = {
  getText: (runId: string, ref: BlobLocation) => Promise<string>;
  getJson: (runId: string, ref: BlobLocation) => Promise<unknown>;
  putJson: (runId: string, key: string, value: unknown) => Promise<StoredBlob>;
  recordReports: (runId: string, file: BlobLocation, reports: SplitReport[]) => Promise<void>;
  findPlaces: (codes: string[]) => Promise<Record<string, string>>;
};

const BLOB = { object: { bucket: 'string', key: 'string' } } as const;

const blobOf = (x: { bucket: string | null; key: string | null }): BlobLocation => {
  if (!x.bucket || !x.key) throw new Error('A stored file needs a bucket and key');
  return { bucket: x.bucket, key: x.key };
};

export const reportKey = (file: BlobLocation, index: number) =>
  `${file.key}.reports/${String(index).padStart(5, '0')}.json`;

const UPLOAD_CONCURRENCY = 16;

const mapLimited = async <T, R>(
  items: T[],
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

export const createNemsisNodes = (store: ReportStore | null): NodeDef[] => {
  const storage = () => {
    if (!store) throw new Error('NEMSIS nodes need blob storage, which only the worker provides');
    return store;
  };
  return [
    actionNode({
      type: 'nemsis.split',
      title: 'Split NEMSIS File',
      category: 'NEMSIS',
      description:
        'Reads a NEMSIS 3.4 or 3.5 export file, stores each patient care report in it as its own file and records the reports against the import.',
      level: 'basic',
      keywords: ['import', 'epcr', 'xml', 'pcr file'],
      effect: true,
      inputs: [pin('file', BLOB, { description: 'The stored NEMSIS export file.' })],
      outputs: [
        pin(
          'reports',
          { list: BLOB },
          {
            description: 'Each patient care report in the file, stored on its own.'
          }
        ),
        pin('count', 'integer', {
          label: 'Reports',
          description: 'How many reports the file held.'
        })
      ],
      compute: async (inputs, _, ctx) => {
        const file = blobOf(inputs.file);
        const { reports } = parseDataset(await storage().getText(ctx.runId, file));
        const refs = await mapLimited(reports, UPLOAD_CONCURRENCY, (report, i) =>
          storage().putJson(ctx.runId, reportKey(file, i), report)
        );
        await storage().recordReports(
          ctx.runId,
          file,
          refs.map((report, i) => ({ position: i, pcrNumber: pcrNumberOf(reports[i]), report }))
        );
        return { reports: refs, count: refs.length };
      }
    }),
    actionNode({
      type: 'nemsis.read-report',
      title: 'Read Patient Care Report',
      category: 'NEMSIS',
      description:
        'Loads one stored patient care report as sections (patient, times, payment, disposition and more) to split into fields, with city codes turned into place names.',
      level: 'basic',
      keywords: ['epcr', 'pcr', 'patient care report', 'load'],
      inputs: [pin('report', BLOB, { description: 'The stored patient care report.' })],
      outputs: [
        pin('pcr', PCR_TYPE, {
          label: 'PCR',
          description: 'The patient care report, section by section.'
        })
      ],
      compute: async (inputs, _, ctx) => {
        const data = (await storage().getJson(ctx.runId, blobOf(inputs.report))) as Json;
        const pcr = toPcr(data);
        const codes = placeCodes(pcr);
        const names = codes.length ? await storage().findPlaces(codes) : {};
        return { pcr: resolvePlaces(pcr, names) };
      }
    })
  ];
};
