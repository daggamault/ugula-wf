import type { NodeDef } from '@ugula/graph';
import { claimTaskNodes } from './claim-tasks.ts';
import { claimNodes } from './claims.ts';
import { cycleNodes } from './cycle.ts';
import { documentationNodes } from './documentation.ts';
import { exchangeNodes } from './exchange.ts';
import { narrativeNodes } from './narrative.ts';
import { patientNodes } from './patients.ts';
import { payerFileNodes } from './payer-files.ts';
import { payerNodes } from './payers.ts';
import { recoveryNodes } from './recovery.ts';
import { scheduleNodes } from './schedules.ts';
import type { BillingStores } from './stores.ts';

export type {
  AppliedPayerFile,
  BillingStores,
  BlobRef,
  CalendarStore,
  ClaimStatusCheck,
  ClaimStore,
  ClaimTaskStore,
  Deadline,
  DraftClaim,
  EligibilityCheck,
  ExchangeStore,
  FeeSchedules,
  FeeStore,
  NewClaimDocument,
  PatientStore,
  PayerFileStore,
  PayerStore,
  ReadPayerFile,
  RecoveryStore,
  Responsibility,
  ScheduleStore
} from './stores.ts';

export const createBillingNodes = (stores: BillingStores | null): NodeDef[] => {
  const storesOf = () => {
    if (!stores) throw new Error('Billing nodes need storage, which only the worker provides');
    return stores;
  };
  return [
    patientNodes,
    claimNodes,
    claimTaskNodes,
    payerNodes,
    narrativeNodes,
    cycleNodes,
    payerFileNodes,
    exchangeNodes,
    documentationNodes,
    recoveryNodes,
    scheduleNodes
  ].flatMap((nodes) => nodes(storesOf));
};
