import type { ClaimPatch } from './claim-fix.ts';
import type { ClaimCheck, NewClaim } from './claim-validation.ts';
import type { ClaimEvent, ClaimStatus, LedgerCoverage } from './claims.ts';
import type { CompletionRequest } from './completions.ts';
import type {
  BillingStores,
  BlobRef,
  ClaimStore,
  DraftClaim,
  FeeStore,
  PatientStore,
  PayerStore,
  StatementSource
} from './nodes/stores.ts';
import type { Patient } from './patients.ts';
import type { DirectoryPayer, PayerCandidate } from './payers.ts';

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
    findFees: async (_, payerId, codes) =>
      Object.fromEntries(
        codes.flatMap((c) => {
          const cents =
            saved.findLast(([p, code]) => code === c && (p === null || p === payerId))?.[2] ??
            price(payerId, c);
          return cents === null ? [] : [[c, cents]];
        })
      ),
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
};

type SavedStatement = { key: string; number: number; count: number; pdf: Uint8Array };

const checkOfSaved = (c: NewClaim): ClaimCheck => ({
  patientId: c.patientId,
  patient: null,
  pcrNumber: c.pcrNumber,
  tripType: c.tripType,
  level: c.level,
  emergency: c.emergency,
  loadedMiles: c.loadedMiles,
  lines: c.lines,
  totalCents: c.totalCents,
  payers: c.coverages.map((cov) => ({
    coverageId: `cov-${cov.payer}`,
    name: cov.payer,
    payerId: cov.payerId,
    claimFiling: cov.payerId ? 'CI' : null,
    memberId: cov.memberId,
    relationship: cov.relationship,
    insuredFirstName: cov.insuredFirstName,
    insuredLastName: cov.insuredLastName
  })),
  details: c.details
});

const patched = (c: ClaimCheck, p: ClaimPatch): ClaimCheck => ({
  ...c,
  tripType: p.tripType ?? c.tripType,
  level: p.level ?? c.level,
  emergency: p.emergency ?? c.emergency,
  loadedMiles: p.loadedMiles ?? c.loadedMiles,
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
    originDestination: p.originDestination ?? c.details.originDestination
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
  stale = false
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
    }
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
  payers: stores.payers ?? {
    lookup: unused('payer'),
    directory: async () => [],
    linkAlias: unused('payer'),
    cachedSuggestion: async () => undefined,
    cacheSuggestion: async () => undefined
  },
  fees: stores.fees ?? { findFees: unused('fee'), saveFee: unused('fee') },
  claims: stores.claims ?? memoryClaims().store,
  completer: stores.completer ?? { complete: unused('completion') }
});

const PLACE = { addressLine: '9 Oak Ave', city: 'Springfield', state: 'IL', postalCode: '62702' };

export const checkedPayer = (name: string, payerId: string | null = `p-${name}`) => ({
  coverageId: `cov-${name}`,
  name,
  payerId,
  claimFiling: payerId ? 'MB' : null,
  memberId: `M-${name}`,
  relationship: '18',
  insuredFirstName: null,
  insuredLastName: null
});

export const completeCheck = (payers = ['Medicare', 'Blue']): ClaimCheck => ({
  patientId: 'p1',
  patient: PLACE,
  pcrNumber: 'PCR-1',
  tripType: 'emergency',
  level: 'ALS1',
  emergency: true,
  loadedMiles: 7.3,
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
    originDestination: 'RH'
  }
});
