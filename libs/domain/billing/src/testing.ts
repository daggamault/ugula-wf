import type { NewClaim } from './claim-validation.ts';
import type { ClaimEvent, LedgerCoverage } from './claims.ts';
import type { CompletionRequest } from './completions.ts';
import type {
  BillingStores,
  BlobRef,
  ClaimStore,
  DraftClaim,
  FeeStore,
  PatientStore,
  PayerStore
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
    }
  };
  return { store, calls };
};

export const memoryPayers = (
  known: Record<string, DirectoryPayer>,
  similar: Record<string, PayerCandidate[]> = {}
) => {
  const aliases = new Map<string, string>();
  const byId = new Map(Object.values(known).map((p) => [p.id, p]));
  for (const p of Object.values(similar).flat()) byId.set(p.id, byId.get(p.id) ?? p);
  const store: PayerStore = {
    lookup: async (_, names) =>
      names.map((name) => {
        const alias = aliases.get(name);
        const linked = known[name] ?? (alias ? byId.get(alias) : undefined);
        return linked
          ? { name, known: linked, candidates: [] }
          : { name, known: null, candidates: similar[name] ?? [] };
      }),
    linkAlias: async (_, name, payerId) => {
      aliases.set(name, payerId);
    }
  };
  return { store, aliases };
};

export const memoryFees = (price: (payerId: string | null, code: string) => number | null) => {
  const store: FeeStore = {
    findFees: async (_, payerId, codes) =>
      Object.fromEntries(
        codes.flatMap((c) => {
          const cents = price(payerId, c);
          return cents === null ? [] : [[c, cents]];
        })
      )
  };
  return { store };
};

export type MemoryClaimOptions = {
  claimId?: string;
  coverages?: LedgerCoverage[];
  totalCents?: number;
  signalsSeen?: number;
  reference?: string;
};

export const memoryClaims = ({
  claimId = 'c1',
  coverages,
  totalCents = 0,
  signalsSeen = 0,
  reference = ''
}: MemoryClaimOptions = {}) => {
  const drafts: DraftClaim[] = [];
  const patients: string[] = [];
  const saved: NewClaim[] = [];
  const statuses: string[] = [];
  const revisions: BlobRef[] = [];
  const events: RecordedEvent[] = [];
  const closed: string[] = [];
  const attached: string[] = [];
  const ledgerCoverages = () =>
    coverages ??
    (saved.at(-1)?.coverages ?? []).map((c) => ({ id: `cov-${c.payer}`, payer: c.payer }));
  const store: ClaimStore = {
    openDraft: async (_, __, draft) => {
      drafts.push(draft);
      return { id: claimId, duplicate: drafts.length > 1 };
    },
    assignPatient: async (_, __, patientId) => {
      patients.push(patientId);
    },
    saveClaim: async (_, __, claim) => {
      saved.push(claim);
    },
    setStatus: async (_, __, status) => {
      statuses.push(status);
    },
    noteRevision: async (_, __, ___, report) => {
      revisions.push(report);
    },
    attachCycle: async (_, __, cycleRunId) => {
      attached.push(cycleRunId);
    },
    statementData: unused('statement'),
    saveStatement: unused('statement'),
    ledger: async (_, id) =>
      id === claimId
        ? { totalCents, coverages: ledgerCoverages(), events, signalsSeen, reference }
        : null,
    recordEvent: async (_, __, key, e) => {
      events.push({ ...e, key, paidCents: 0, adjustedCents: 0, at: '2026-01-01T00:00:00.000Z' });
    },
    closeClaim: async (_, __, ___, status) => {
      closed.push(status);
    }
  };
  return { store, drafts, patients, saved, statuses, revisions, events, closed, attached };
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
    createPatient: unused('patient')
  },
  payers: stores.payers ?? { lookup: unused('payer'), linkAlias: unused('payer') },
  fees: stores.fees ?? { findFees: unused('fee') },
  claims: stores.claims ?? memoryClaims().store,
  completer: stores.completer ?? { complete: unused('completion') }
});
