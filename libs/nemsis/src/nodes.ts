import { actionNode, type Json, type NodeDef, pin } from '@ugula/graph';
import { parseDataset, pcrNumberOf } from './parse.ts';
import { PCR_TYPE, placeCodes, resolvePlaces, toPcr } from './pcr.ts';

type BlobLocation = { bucket: string; key: string };

type StoredBlob = BlobLocation & { size: number; contentType: string };

export type SplitReport = { position: number; pcrNumber: string | null; report: StoredBlob };

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

export const UPLOAD_CONCURRENCY = 16;

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
        'Parses a NEMSIS 3.5 EMSDataSet file, stores each patient care report as its own blob and records the reports against the import.',
      effect: true,
      inputs: [pin('file', BLOB)],
      outputs: [pin('reports', { list: BLOB }), pin('count', 'integer')],
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
        'Loads one stored patient care report as typed sections (patient, times, payment, disposition and more) for Break nodes to split into fields, with GNIS city codes resolved to place names. Also outputs the raw report.',
      inputs: [pin('report', BLOB)],
      outputs: [pin('pcr', PCR_TYPE), pin('data', { object: {} })],
      compute: async (inputs, _, ctx) => {
        const data = (await storage().getJson(ctx.runId, blobOf(inputs.report))) as Json;
        const pcr = toPcr(data);
        const codes = placeCodes(pcr);
        const names = codes.length ? await storage().findPlaces(codes) : {};
        return { pcr: resolvePlaces(pcr, names), data };
      }
    })
  ];
};
