import type { FeeStore, PatientStore, PayerStore } from './nodes/stores.ts';
import type { Patient } from './patients.ts';
import type { DirectoryPayer, PayerCandidate } from './payers.ts';

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
