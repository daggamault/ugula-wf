import type { NodeDef } from '@ugula/graph';
import { claimNodes } from './claims.ts';
import { cycleNodes } from './cycle.ts';
import { narrativeNodes } from './narrative.ts';
import { patientNodes } from './patients.ts';
import { payerNodes } from './payers.ts';
import type { BillingStores } from './stores.ts';

export type {
  AgencyProfile,
  BillingStores,
  BlobRef,
  CandidateQuery,
  ClaimStore,
  DraftClaim,
  FeeStore,
  PatientStore,
  PayerStore,
  StatementSource
} from './stores.ts';

export const createBillingNodes = (stores: BillingStores | null): NodeDef[] => {
  const storesOf = () => {
    if (!stores) throw new Error('Billing nodes need storage, which only the worker provides');
    return stores;
  };
  return [patientNodes, claimNodes, payerNodes, narrativeNodes, cycleNodes].flatMap((nodes) =>
    nodes(storesOf)
  );
};
