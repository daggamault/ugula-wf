import type { ClaimDocument } from './claim-documents.ts';
import type { ClaimPatch } from './claim-fix.ts';
import type { ClaimCheck, NewClaim } from './claim-validation.ts';
import type { ClaimEvent, ClaimStatus, LedgerCoverage } from './claims.ts';
import type { CompletionRequest } from './completions.ts';
import type { Documentation } from './documentation.ts';
import type { CheckedFacility } from './facilities.ts';
import type {
  BillingStores,
  BlobRef,
  ClaimStore,
  DraftClaim,
  FeeStore,
  PatientStore,
  PayerStore,
  Responsibility,
  SavedSubmission,
  SentClaimFile,
  StatementSource,
  SubmissionSource
} from './nodes/stores.ts';
import type { Patient } from './patients.ts';
import type { DirectoryPayer, PayerCandidate } from './payers.ts';
import { localDate } from './statements.ts';
import type { Submitter, X837Claim } from './x837.ts';

export type RecordedEvent = ClaimEvent & { key: string; note: string };

const unused = (store: string) => async () => {
  throw new Error(`The ${store} store is not used here`);
};

export const memoryPatients = (existing: Patient[]) => {
  const calls: unknown[][] = [];
  const store: PatientStore = {
    findCandidates: async (runId, query) => {
      calls.push(['findCandidates', runId, query]);
      return existing;
    },
    findPatient: async (runId, id) => {
      calls.push(['findPatient', runId, id]);
      return existing.find((p) => p.id === id) ?? null;
    },
    createPatient: async (runId, key, patient, reuseMatch) => {
      calls.push(['createPatient', runId, key, reuseMatch]);
      return { id: 'new', ...patient };
    },
    updateAddress: async (runId, key, id, address) => {
      calls.push(['updateAddress', runId, key, id, address]);
      const found = existing.find((p) => p.id === id);
      if (!found) throw new Error(`Patient ${id} does not exist`);
      return { ...found, ...address };
    }
  };
  return { store, calls };
};

export const memoryPayers = (
  known: Record<string, DirectoryPayer>,
  similar: Record<string, PayerCandidate[]> = {},
  { searchDown = false }: { searchDown?: boolean } = {}
) => {
  const aliases = new Map<string, string>();
  const suggestions = new Map<string, string | null>();
  const byId = new Map(Object.values(known).map((p) => [p.id, p]));
  for (const p of Object.values(similar).flat()) {
    byId.set(p.id, byId.get(p.id) ?? { id: p.id, name: p.name, claimFiling: p.claimFiling });
  }
  const store: PayerStore = {
    lookup: async (_, names, withSimilar) => {
      if (withSimilar && searchDown) throw new Error('The embedding server is down');
      return names.map((name) => {
        const alias = aliases.get(name);
        const linked = known[name] ?? (alias ? byId.get(alias) : undefined);
        return linked
          ? { name, known: linked, candidates: [] }
          : { name, known: null, candidates: withSimilar ? (similar[name] ?? []) : [] };
      });
    },
    directory: async () => [...byId.values()],
    linkAlias: async (_, name, payerId) => {
      if (!byId.has(payerId)) return false;
      aliases.set(name, payerId);
      return true;
    },
    cachedSuggestion: async (_, name) => suggestions.get(name),
    cacheSuggestion: async (_, name, payerId) => {
      suggestions.set(name, payerId);
    }
  };
  return { store, aliases, suggestions };
};

export const memoryFees = (price: (payerId: string | null, code: string) => number | null) => {
  const saved: [string | null, string, number][] = [];
  const store: FeeStore = {
    findSchedules: async (_, payerId, codes) => {
      const schedule = (payer: string | null) =>
        Object.fromEntries(
          codes.flatMap((c) => {
            const cents =
              saved.findLast(([p, code]) => code === c && p === payer)?.[2] ?? price(payer, c);
            return cents === null ? [] : [[c, cents]];
          })
        );
      return { payer: payerId === null ? {} : schedule(payerId), default: schedule(null) };
    },
    saveFee: async (_, payerId, code, cents) => {
      saved.push([payerId, code, cents]);
    }
  };
  return { store, saved };
};

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
  tripType: c.tripType,
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
  tripType: p.tripType ?? c.tripType,
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

export const scriptedCompleter = (answer: (request: CompletionRequest) => unknown) => {
  const asked: CompletionRequest[] = [];
  return {
    asked,
    completer: {
      complete: async (request: CompletionRequest) => {
        asked.push(request);
        return answer(request);
      }
    }
  };
};

export const billingStores = (stores: Partial<BillingStores> = {}): BillingStores => ({
  patients: stores.patients ?? {
    findCandidates: unused('patient'),
    findPatient: unused('patient'),
    createPatient: unused('patient'),
    updateAddress: unused('patient')
  },
  payerFiles: stores.payerFiles ?? { read: unused('payer file'), apply: unused('payer file') },
  exchange: stores.exchange ?? {
    checkEligibility: unused('clearinghouse'),
    checkClaimStatus: unused('clearinghouse')
  },
  payers: stores.payers ?? {
    lookup: unused('payer'),
    directory: async () => [],
    linkAlias: unused('payer'),
    cachedSuggestion: async () => undefined,
    cacheSuggestion: async () => undefined
  },
  fees: stores.fees ?? { findSchedules: unused('fee'), saveFee: unused('fee') },
  claims: stores.claims ?? memoryClaims().store,
  recovery: stores.recovery ?? {
    recordRefund: unused('recovery'),
    protectBalance: unused('recovery'),
    skipRemainingPayers: unused('recovery'),
    addPayer: unused('recovery'),
    appealPacket: unused('recovery'),
    saveAppealPacket: unused('recovery')
  },
  schedules: stores.schedules ?? {
    deadlines: unused('schedule'),
    raiseTask: unused('schedule'),
    facilityInvoices: unused('schedule'),
    saveFacilityInvoice: unused('schedule')
  },
  calendar: stores.calendar ?? { today: async (_, at) => localDate(at, 'America/Chicago') },
  completer: stores.completer ?? { complete: unused('completion') }
});

const PLACE = { addressLine: '9 Oak Ave', city: 'Springfield', state: 'IL', postalCode: '62702' };

const checkedPayer = (name: string, payerId: string | null = `p-${name}`) => ({
  coverageId: `cov-${name}`,
  name,
  payerId,
  claimFiling: payerId ? 'MB' : null,
  memberId: `M-${name}`,
  relationship: '18',
  insuredFirstName: null,
  insuredLastName: null,
  filingLimitDays: null,
  eligibility: null,
  eligibilityNote: null,
  stay: null
});

export const COMPLETE_DOCUMENTATION: Documentation = {
  signature: 'signed',
  signatureNote: null,
  pcsOnFile: null,
  pcsSignedOn: null,
  transportReason: 'A',
  conditionCodes: [],
  priorAuthorization: null,
  weightKg: null,
  atScene: '2025-12-30T10:05:00Z',
  leftScene: '2025-12-30T10:25:00Z',
  atDestination: '2025-12-30T10:40:00Z',
  patientCount: null,
  closestFacilityMiles: null,
  abnOnFile: null,
  abnSignedOn: null,
  denialExpected: null,
  mspEmployerPlan: null,
  mspEsrd: null,
  mspDisability: null,
  mspAccident: null,
  priorAuthorizationExpiresOn: null,
  pcsType: null,
  roundTrips: null,
  admissionDate: null,
  facilityStay: null
};

export const completeCheck = (payers = ['Medicare', 'Blue']): ClaimCheck => ({
  patientId: 'p1',
  patient: PLACE,
  pcrNumber: 'PCR-1',
  tripType: 'emergency',
  level: 'ALS1',
  emergency: true,
  loadedMiles: 7.3,
  deceased: false,
  nonCoveredMiles: null,
  pickupFacility: null,
  destinationFacility: null,
  responsibleParty: 'payer',
  responsibilityRecorded: false,
  documents: [],
  timeZone: 'America/Chicago',
  lines: [
    { code: 'A0427', units: 1, unitCents: 92_700, totalCents: 92_700 },
    { code: 'A0425', units: 7.3, unitCents: 1_000, totalCents: 7_300 }
  ],
  totalCents: 100_000,
  payers: payers.map((p) => checkedPayer(p)),
  details: {
    serviceDate: '2025-12-30',
    pickup: { name: null, ...PLACE },
    destination: { name: 'Mercy', ...PLACE },
    diagnoses: ['R079'],
    originDestination: 'RH',
    documentation: COMPLETE_DOCUMENTATION
  }
});

export const sampleSubmitter: Submitter = {
  organizationName: 'Metro EMS',
  npi: '1234567893',
  taxId: '123456789',
  addressLine: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  postalCode: '627011234',
  phone: '2175550100',
  submitterId: 'SUB01',
  receiverId: 'RCV01',
  receiverName: 'Demo Clearinghouse',
  production: false
};

const place = { addressLine: '9 Oak Ave', city: 'Springfield', state: 'IL', postalCode: '62702' };

export const sampleLine = {
  code: 'A0427',
  modifiers: ['RH'],
  chargeCents: 85_000,
  units: 1,
  serviceDate: '2026-10-01'
};

export const sampleX837: X837Claim = {
  claimId: 'c-1',
  placeOfService: '41',
  frequency: '1',
  admissionDate: null,
  payerClaimNumber: null,
  priorAuthorization: null,
  note: null,
  subscriber: {
    relationship: '18',
    lastName: "O'Brien~*",
    firstName: 'José',
    memberId: '1EG4TE5MK73',
    groupId: null
  },
  patient: {
    lastName: "O'Brien~*",
    firstName: 'José',
    birthDate: '1950-02-03',
    sex: 'M',
    ...place
  },
  payer: { name: 'Medicare', payerId: 'DEMOMCR', claimFiling: 'MB', insuranceType: null },
  otherPayers: [],
  weightPounds: null,
  transportReason: 'A',
  loadedMiles: 7.33,
  conditionCodes: ['09', '06'],
  diagnoses: ['R079', 'I10'],
  pickup: { name: null, ...place },
  dropoff: { name: 'Mercy Hospital', ...place, addressLine: '100 Health Way' },
  lines: [
    sampleLine,
    { code: 'A0425', modifiers: ['RH'], chargeCents: 9_250, units: 7.4, serviceDate: '2026-10-01' }
  ]
};
