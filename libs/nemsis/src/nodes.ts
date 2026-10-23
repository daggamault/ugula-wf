import { type JsonValue, parseDataset, pcrNumberOf } from './parse.ts';

type ValueType =
  | 'any'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'datetime'
  | { list: ValueType }
  | { object: Record<string, ValueType> };

type Pin = { name: string; type: ValueType };

type BlobLocation = { bucket: string; key: string };

type StoredBlob = BlobLocation & { size: number; contentType: string };

export type SplitReport = { position: number; pcrNumber: string | null; report: StoredBlob };

export type ReportStore = {
  getText: (runId: string, ref: BlobLocation) => Promise<string>;
  getJson: (runId: string, ref: BlobLocation) => Promise<unknown>;
  putJson: (runId: string, key: string, value: unknown) => Promise<StoredBlob>;
  recordReports: (runId: string, file: BlobLocation, reports: SplitReport[]) => Promise<void>;
};

export type HostNode = {
  type: string;
  version: number;
  title: string;
  category: string;
  description: string;
  effect: boolean;
  signature: { execIn: string[]; execOut: string[]; inputs: Pin[]; outputs: Pin[] };
  run: (inv: { read: (pin: string) => Promise<unknown>; ctx: { runId: string } }) => Promise<{
    type: 'next';
    pin: string;
    outputs: Record<string, JsonValue>;
  }>;
};

const BLOB: ValueType = { object: { bucket: 'string', key: 'string' } };

const action = (inputs: Pin[], outputs: Pin[]) => ({
  execIn: ['exec'],
  execOut: ['then'],
  inputs,
  outputs
});

export const reportKey = (file: BlobLocation, index: number) =>
  `${file.key}.reports/${String(index).padStart(5, '0')}.json`;

export const createNemsisNodes = (store: ReportStore | null): HostNode[] => {
  const storage = () => {
    if (!store) throw new Error('NEMSIS nodes need blob storage, which only the worker provides');
    return store;
  };
  return [
    {
      type: 'nemsis.split',
      version: 1,
      title: 'Split NEMSIS File',
      category: 'NEMSIS',
      description:
        'Parses a NEMSIS 3.5 EMSDataSet file, stores each patient care report as its own blob and records the reports against the import.',
      effect: true,
      signature: action(
        [{ name: 'file', type: BLOB }],
        [
          { name: 'reports', type: { list: BLOB } },
          { name: 'count', type: 'integer' }
        ]
      ),
      run: async ({ read, ctx }) => {
        const file = (await read('file')) as BlobLocation;
        const { reports } = parseDataset(await storage().getText(ctx.runId, file));
        const refs = await Promise.all(
          reports.map((report, i) => storage().putJson(ctx.runId, reportKey(file, i), report))
        );
        await storage().recordReports(
          ctx.runId,
          file,
          refs.map((report, i) => ({ position: i, pcrNumber: pcrNumberOf(reports[i]), report }))
        );
        return { type: 'next', pin: 'then', outputs: { reports: refs, count: refs.length } };
      }
    },
    {
      type: 'nemsis.read-report',
      version: 1,
      title: 'Read Patient Care Report',
      category: 'NEMSIS',
      description: 'Loads one stored patient care report so its fields can be used.',
      effect: false,
      signature: action([{ name: 'report', type: BLOB }], [{ name: 'data', type: { object: {} } }]),
      run: async ({ read, ctx }) => ({
        type: 'next',
        pin: 'then',
        outputs: {
          data: (await storage().getJson(
            ctx.runId,
            (await read('report')) as BlobLocation
          )) as JsonValue
        }
      })
    }
  ];
};
