import type { NodeDef } from '@ugula/graph';
import { accountingNodes } from './accounting.ts';
import { claimTaskNodes } from './claim-tasks.ts';
import { claimNodes } from './claims.ts';
import { cycleNodes } from './cycle.ts';
import { documentNodes } from './documents.ts';
import { exchangeNodes } from './exchange.ts';
import { issueNodes } from './issues.ts';
import { narrativeNodes } from './narrative.ts';
import { patientNodes } from './patients.ts';
import { payerFileNodes } from './payer-files.ts';
import { payerNodes } from './payers.ts';
import { recoveryNodes } from './recovery.ts';
import { referenceNodes } from './reference.ts';
import { scheduleNodes } from './schedules.ts';
import type { BillingStores } from './stores.ts';

export type {
  AccountingStore,
  AppliedPayerFile,
  BillingStores,
  BlobRef,
  CalendarStore,
  ClaimStatusCheck,
  ClaimStore,
  ClaimTaskStore,
  DeadlineFacts,
  DepositPair,
  DiscoveryCheck,
  DocumentStore,
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
  ReferenceStore,
  Responsibility,
  ScheduleStore,
  UnmatchedPayment
} from './stores.ts';

export const createBillingNodes = (stores: BillingStores | null): NodeDef[] => {
  const storesOf = () => {
    if (!stores) throw new Error('Billing nodes need storage, which only the worker provides');
    return stores;
  };
  return [
    patientNodes,
    claimNodes,
    referenceNodes,
    claimTaskNodes,
    payerNodes,
    narrativeNodes,
    cycleNodes,
    payerFileNodes,
    exchangeNodes,
    issueNodes,
    recoveryNodes,
    scheduleNodes,
    documentNodes,
    accountingNodes
  ].flatMap((nodes) => nodes(storesOf));
};
