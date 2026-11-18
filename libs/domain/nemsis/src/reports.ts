import type { Json, ValueType } from '@ugula/graph';

export const BLOB = { object: { bucket: 'string', key: 'string' } } as const satisfies ValueType;

export type BlobLocation = { bucket: string; key: string };

type StoredBlob = BlobLocation & { size: number; contentType: string };

type SplitReport = { position: number; pcrNumber: string | null; report: StoredBlob };

export type StoredReport = { id: string; report: StoredBlob };

export type ReportStore = {
  getText: (runId: string, ref: BlobLocation) => Promise<string>;
  getJson: (runId: string, ref: BlobLocation) => Promise<unknown>;
  putJson: (runId: string, key: string, value: unknown) => Promise<StoredBlob>;
  putBytes: (runId: string, key: string, bytes: Uint8Array) => Promise<StoredBlob>;
  recordReports: (
    runId: string,
    file: BlobLocation,
    importId: string | null,
    reports: SplitReport[]
  ) => Promise<string[]>;
  findReport: (runId: string, id: string) => Promise<StoredReport | null>;
  findPlaces: (codes: string[]) => Promise<Record<string, string>>;
};

export const ENCOUNTER_OUTCOMES = ['created', 'revised', 'unchanged'] as const;

export type EncounterOutcome = (typeof ENCOUNTER_OUTCOMES)[number];

type SavedEncounter = { id: string; revision: number; outcome: EncounterOutcome };

export type EncounterStore = {
  saveEncounter: (
    runId: string,
    pcrNumber: string,
    data: Record<string, Json>,
    reportId: string | null
  ) => Promise<SavedEncounter>;
  findEncounter: (
    runId: string,
    id: string
  ) => Promise<{ revision: number; reportId: string | null; data: Json } | null>;
};

export const reportKey = (file: BlobLocation, index: number) =>
  `${file.key}.reports/${String(index).padStart(5, '0')}.json`;

export const attachmentKey = (report: BlobLocation, index: number) =>
  `${report.key}.files/${String(index).padStart(3, '0')}`;
