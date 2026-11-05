import type { ClaimStore, Clearinghouse } from '@ugula/billing';
import type { Db } from '@ugula/db';
import type { RunQueueClient } from '@ugula/run-queue';
import type { BlobStore } from '@ugula/storage';
import { createCycleStore } from './claim-cycle.ts';
import { createDraftStore } from './claim-drafts.ts';
import { createFacilityStore } from './claim-facilities.ts';
import { createLedgerStore } from './claim-ledger.ts';
import { createStatementStore } from './claim-statements.ts';
import { createSubmissionStore } from './claim-submissions.ts';

export const createClaimStore = (
  db: Db,
  blobs: Pick<BlobStore, 'putBytes' | 'getBytes'>,
  boss: RunQueueClient,
  clearinghouseFor: (agencyId: string) => Promise<Clearinghouse | null> = async () => null
): ClaimStore => {
  const ledger = createLedgerStore(db);
  return {
    ...createDraftStore(db, boss),
    ...createStatementStore(db, blobs),
    ...ledger,
    ...createCycleStore(db, boss),
    ...createFacilityStore(db, boss),
    ...createSubmissionStore(db, blobs, ledger.ledger, clearinghouseFor)
  };
};
