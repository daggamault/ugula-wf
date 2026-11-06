import type { ClaimDocument } from './claim-documents.ts';
import type { ClaimPatch } from './claim-fix.ts';
import type { ClaimCheck, NewClaim } from './claim-validation.ts';
import type { ClaimEvent, ClaimStatus, LedgerCoverage } from './claims.ts';
import type { CheckedFacility } from './facilities.ts';
import type {
  BlobRef,
  ClaimStore,
  DraftClaim,
  Responsibility,
  SavedSubmission,
  SentClaimFile,
  StatementSource,
  SubmissionSource
} from './nodes/stores.ts';
import { unused } from './testing-unused.ts';

export type RecordedEvent = ClaimEvent & { key: string; note: string };

export type MemoryClaimOptions = {
  claimId?: string;
  coverages?: LedgerCoverage[];
  totalCents?: number;
  signalsSeen?: number;
  reference?: string;
  statement?: StatementSource;
  check?: ClaimCheck;
  status?: ClaimStatus;
  previous?: BlobRef | null;
  stale?: boolean;
  submission?: SubmissionSource;
  saving?: SavedSubmission;
  sending?: SentClaimFile;
  facilities?: CheckedFacility[];
  documents?: ClaimDocument[];
};

type SavedStatement = { key: string; number: number; count: number; pdf: Uint8Array };

type FiledClaim = { key: string; coverageId: string; resubmission: boolean; file: string };

const checkOfSaved = (c: NewClaim): ClaimCheck => ({
  patientId: c.patientId,
  patient: null,
  pcrNumber: c.pcrNumber,
  classification: c.classification,
  level: c.level,
  emergency: c.emergency,
  loadedMiles: c.loadedMiles,
  deceased: c.deceased,
  nonCoveredMiles: c.nonCoveredMiles,
  lines: c.lines,
  totalCents: c.totalCents,
  pickupFacility: null,
  destinationFacility: null,
  responsibleParty: 'payer',
  responsibilityRecorded: false,
  documents: [],
  timeZone: 'America/Chicago',
  payers: c.coverages.map((cov) => ({
    coverageId: `cov-${cov.payer}`,
    name: cov.payer,
    payerId: cov.payerId,
    claimFiling: cov.payerId ? 'CI' : null,
    memberId: cov.memberId,
    relationship: cov.relationship,
    insuredFirstName: cov.insuredFirstName,
    insuredLastName: cov.insuredLastName,
    filingLimitDays: null,
    eligibility: null,
    eligibilityNote: null,
    stay: null
  })),
  details: c.details
});

const patched = (c: ClaimCheck, p: ClaimPatch): ClaimCheck => ({
  ...c,
  classification: p.classification ?? c.classification,
  level: p.level ?? c.level,
  emergency: p.emergency ?? c.emergency,
  loadedMiles: p.loadedMiles ?? c.loadedMiles,
  deceased: p.deceased ?? c.deceased,
  nonCoveredMiles: p.nonCoveredMiles === null ? c.nonCoveredMiles : p.nonCoveredMiles || null,
  patient: p.patientAddress ?? c.patient,
  lines: p.lines ?? c.lines,
  totalCents: p.lines ? p.lines.reduce((sum, l) => sum + l.totalCents, 0) : c.totalCents,
  payers: [
    ...c.payers,
    ...(p.newCoverage
      ? [
          {
            coverageId: `cov-${p.newCoverage.payerId}`,
            name: p.newCoverage.payerId,
            claimFiling: 'CI',
            filingLimitDays: null,
            eligibility: null,
            eligibilityNote: null,
            stay: null,
            ...p.newCoverage
          }
        ]
      : [])
  ].flatMap((payer) => {
    const cov = p.coverage;
    if (!cov || cov.coverageId !== payer.coverageId) return [payer];
    if (cov.remove) return [];
    return [
      {
        ...payer,
        payerId: cov.payerId ?? payer.payerId,
        claimFiling: cov.payerId ? 'CI' : payer.claimFiling,
        memberId: cov.memberId ?? payer.memberId,
        relationship: cov.relationship ?? payer.relationship,
        insuredFirstName: cov.insuredFirstName ?? payer.insuredFirstName,
        insuredLastName: cov.insuredLastName ?? payer.insuredLastName
      }
    ];
  }),
  details: {
    serviceDate: p.serviceDate ?? c.details.serviceDate,
    pickup: p.pickup ?? c.details.pickup,
    destination: p.destination ?? c.details.destination,
    diagnoses: p.diagnoses ?? c.details.diagnoses,
    originDestination: p.originDestination ?? c.details.originDestination,
    documentation: p.documentation
      ? {
          ...c.details.documentation,
          ...Object.fromEntries(Object.entries(p.documentation).filter(([, v]) => v !== null))
        }
      : c.details.documentation
  }
});

export const memoryClaims = ({
  claimId = 'c1',
  coverages,
  totalCents = 0,
  signalsSeen = 0,
  reference = '',
  statement,
  check,
  status = 'draft',
  previous = null,
  stale = false,
  submission,
  saving = { controlNumber: 1 },
  sending = 'manual',
  facilities = [],
  documents = []
}: MemoryClaimOptions = {}) => {
  const drafts: DraftClaim[] = [];
  const patients: string[] = [];
  const saved: NewClaim[] = [];
  const patches: ClaimPatch[] = [];
  const statuses: string[] = [];
  const revisions: BlobRef[] = [];
  const events: RecordedEvent[] = [];
  const closed: string[] = [];
  const attached: string[] = [];
  const statements: SavedStatement[] = [];
  const filed: FiledClaim[] = [];
  const sent: number[] = [];
  const responsibilities: Responsibility[] = [];
  let current: ClaimCheck | null = check ?? null;
  const ledgerCoverages = () =>
    coverages ??
    (current?.payers ?? []).flatMap((p) =>
      p.coverageId ? [{ id: p.coverageId, payer: p.name }] : []
    );
  const store: ClaimStore = {
    openDraft: async (_, __, draft) => {
      drafts.push(draft);
      return {
        id: draft.claimId ?? claimId,
        duplicate: draft.claimId === null && drafts.length > 1
      };
    },
    assignPatient: async (_, __, ___, patientId) => {
      patients.push(patientId);
    },
    saveClaim: async (_, __, ___, claim) => {
      saved.push(claim);
      current = checkOfSaved(claim);
    },
    claimCheck: async (_, id) => (id === claimId ? current : null),
    patchClaim: async (_, __, key, patch) => {
      patches.push(patch);
      if (current) current = patched(current, patch);
      events.push({
        kind: 'edited',
        coverageId: null,
        key,
        note: patch.note ?? '',
        paidCents: 0,
        adjustedCents: 0,
        payerClaimNumber: null,
        paidOn: null,
        adjustments: [],
        at: '2026-01-01T00:00:00.000Z'
      });
    },
    setStatus: async (_, __, ___, next) => {
      statuses.push(next);
      return stale && statuses.length === 1 ? 'stale' : 'set';
    },
    noteRevision: async (_, __, ___, report) => {
      revisions.push(report);
      return { status, previous };
    },
    attachCycle: async (_, __, ___, cycleRunId) => {
      attached.push(cycleRunId);
    },
    statementData: statement ? async () => statement : unused('statement'),
    saveStatement: async (_, __, key, saved) => {
      statements.push({ key, ...saved });
    },
    ledger: async (_, id) =>
      id === claimId
        ? {
            totalCents: current?.totalCents ?? totalCents,
            coverages: ledgerCoverages(),
            events,
            signalsSeen,
            reference
          }
        : null,
    recordEvent: async (_, __, key, e) => {
      events.push({
        ...e,
        key,
        paidCents: 0,
        adjustedCents: 0,
        paidOn: null,
        adjustments: [],
        at: '2026-01-01T00:00:00.000Z'
      });
    },
    closeClaim: async (_, __, ___, closing) => {
      closed.push(closing);
    },
    submission: submission ? async () => submission : unused('submission'),
    saveSubmission: async (_, __, key, f) => {
      if (typeof saving === 'object') {
        filed.push({
          key,
          coverageId: f.coverageId,
          resubmission: f.resubmission,
          file: f.build(saving.controlNumber)
        });
      }
      return saving;
    },
    linkRun: async (_, id) => {
      attached.push(`claim:${id}`);
    },
    sendClaimFile: async (_, __, controlNumber) => {
      if (sending !== 'manual') sent.push(controlNumber);
      return sending;
    },
    setResponsibility: async (_, __, ___, r) => {
      responsibilities.push(r);
    },
    facilityDirectory: async () => facilities,
    claimDocument: async (_, id, documentId) =>
      id === claimId ? (documents.find((d) => d.id === documentId) ?? null) : null
  };
  return {
    store,
    drafts,
    patients,
    saved,
    patches,
    statuses,
    revisions,
    events,
    closed,
    attached,
    statements,
    filed,
    sent,
    responsibilities,
    current: () => current
  };
};
