import type { CompletionRequest } from './completions.ts';
import type { BillingStores } from './nodes/stores.ts';
import { localDate } from './statements.ts';
import { memoryClaims } from './testing-claims.ts';
import { unused } from './testing-unused.ts';

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
  claimTasks: stores.claimTasks ?? {
    setPayers: unused('claim task'),
    postPayment: unused('claim task'),
    addDocument: unused('claim task')
  },
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
