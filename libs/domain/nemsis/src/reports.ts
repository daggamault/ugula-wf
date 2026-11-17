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

export const reportKey = (file: BlobLocation, index: number) =>
  `${file.key}.reports/${String(index).padStart(5, '0')}.json`;
