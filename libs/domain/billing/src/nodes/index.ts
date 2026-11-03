import type { NodeDef } from '@ugula/graph';
import { claimNodes } from './claims.ts';
import { cycleNodes } from './cycle.ts';
import { documentationNodes } from './documentation.ts';
import { narrativeNodes } from './narrative.ts';
import { patientNodes } from './patients.ts';
import { payerFileNodes } from './payer-files.ts';
import { payerNodes } from './payers.ts';
import type { BillingStores } from './stores.ts';

export type {
  AgencyProfile,
  AppliedPayerFile,
  BillingStores,
  BlobRef,
  CandidateQuery,
  ClaimStore,
  DraftClaim,
  FeeStore,
  PatientStore,
  PayerFileLine,
  PayerFileStore,
  PayerStore,
  SavedSubmission,
  SentClaimFile,
  StatementSource,
  SubmissionFile,
  SubmissionSource
} from './stores.ts';

export const createBillingNodes = (stores: BillingStores | null): NodeDef[] => {
  const storesOf = () => {
    if (!stores) throw new Error('Billing nodes need storage, which only the worker provides');
    return stores;
  };
  return [
    patientNodes,
    claimNodes,
    payerNodes,
    narrativeNodes,
    cycleNodes,
    payerFileNodes,
    documentationNodes
  ].flatMap((nodes) => nodes(storesOf));
};
