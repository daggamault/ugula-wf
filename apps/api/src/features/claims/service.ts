import {
  CLAIM_TASKS,
  type ClaimTaskKey,
  checkFactsOf,
  claimCodeRefs,
  ledgerFactsOf,
  readClaimStep,
  readIssues
} from '@ugula/billing';
import {
  type Db,
  describeCodes,
  findClaimCheck,
  findPublishedGraphs,
  lockClaim,
  startRun,
  unchangeable
} from '@ugula/db';
import type { RunQueueClient } from '@ugula/run-queue';
import type { BlobRef, BlobStore } from '@ugula/storage';
import { listLedgerEvents } from '../../shared/ledger.ts';
import { type Announce, announced } from '../../shared/live.ts';
import type { PageRequest } from '../../shared/paging.ts';
import { fail, ok, type Result } from '../../shared/result.ts';
import type { RuleRunner } from '../../shared/rules.ts';
import { type ClaimFilters, claimExists, findClaim, listClaims } from './claim-queries.ts';
import { hasActiveRun, setCycleRun } from './cycle-queries.ts';
import { findClaimDocument, listClaimDocuments } from './document-queries.ts';
import {
  findEventDocument,
  listClaimEvents,
  listClaimFiles,
  listClaimPayerFiles
} from './event-queries.ts';
import type { ClaimEventSort } from './schemas.ts';

type ClaimServiceDeps = {
  db: Db;
  boss: RunQueueClient;
  now: () => Date;
  blobs: Pick<BlobStore, 'getBytes'>;
  announce: Announce;
  rules: RuleRunner;
};

export const NEXT_CLAIM_STEP_RULE = 'billing.next-claim-step';

export const CLAIM_CHECKS_RULE = 'billing.claim-checks';

const CYCLE_WORKFLOW = { key: 'billing.cycle-claim', version: 1 };

const unpublished = (key: string) => fail('not_found', `The ${key} workflow is not published`);

const notFound = fail('not_found', 'Claim not found');
export const createClaimService = ({ db, boss, now, blobs, announce, rules }: ClaimServiceDeps) => {
  const write = <T>(agencyId: string, id: string, work: (tx: Db) => Promise<Result<T>>) =>
    announced(announce, agencyId, db.transaction().execute(work), () => [{ kind: 'claim', id }]);

  return {
    list: async (agencyId: string, filters: ClaimFilters) =>
      ok(await listClaims(db, agencyId, filters)),

    find: async (agencyId: string, id: string) => {
      const claim = await findClaim(db, agencyId, id);
      if (!claim) return notFound;
      const open = unchangeable(claim.status) === null;
      const [files, payerFiles, documents, events, check, codes] = await Promise.all([
        listClaimFiles(db, id),
        listClaimPayerFiles(db, id),
        listClaimDocuments(db, id),
        open ? listLedgerEvents(db, id) : [],
        findClaimCheck(db, agencyId, id),
        describeCodes(db, claimCodeRefs(claim))
      ]);
      const at = now();
      const ledger = open
        ? ledgerFactsOf(
            {
              totalCents: claim.total_cents,
              coverages: claim.coverages.map((c) => ({
                id: c.id,
                payer: c.payer,
                claimFiling: c.claim_filing
              })),
              events,
              facilityId: claim.facility_id
            },
            at
          )
        : null;
      const [step, checked] = await Promise.all([
        ledger ? rules(agencyId, NEXT_CLAIM_STEP_RULE, { ledger }, at) : null,
        check ? rules(agencyId, CLAIM_CHECKS_RULE, { facts: checkFactsOf(check, at) }, at) : null
      ]);
      return ok({
        claim,
        files,
        payerFiles,
        documents,
        codes,
        progress: step && ledger ? readClaimStep(step, ledger) : null,
        issues: readIssues(checked?.issues)
      });
    },

    events: async (agencyId: string, id: string, page: PageRequest<ClaimEventSort>) =>
      (await claimExists(db, agencyId, id)) ? ok(await listClaimEvents(db, id, page)) : notFound,

    document: async (agencyId: string, claimId: string, eventId: string) => {
      const found = await findEventDocument(db, agencyId, claimId, eventId);
      if (!found) return fail('not_found', 'Document not found');
      const ref = found.document as BlobRef;
      return ok({
        bytes: await blobs.getBytes(ref),
        contentType: ref.contentType,
        name: ref.key.split('/').at(-1) ?? 'document'
      });
    },

    documentFile: async (agencyId: string, id: string, documentId: string) => {
      const found = await findClaimDocument(db, agencyId, id, documentId);
      if (!found) return fail('not_found', 'Document not found');
      const ref = found.document as BlobRef;
      return ok({
        bytes: await blobs.getBytes(ref),
        contentType: ref.contentType,
        name: found.file_name
      });
    },

    restartCycle: (agencyId: string, id: string) =>
      write(agencyId, id, async (tx) => {
        const claim = await lockClaim(tx, agencyId, id);
        if (!claim) return notFound;
        const blocked = unchangeable(claim.status);
        if (blocked) return blocked;
        if (await hasActiveRun(tx, id)) {
          return fail('conflict', 'This claim still has an active workflow run');
        }
        const [version] = await findPublishedGraphs(tx, agencyId, [CYCLE_WORKFLOW]);
        if (!version) return fail('not_found', 'The claim cycle workflow is not published');
        const runId = await startRun(tx, boss, {
          agencyId,
          versionId: version.id,
          inputs: { claimId: id },
          interactive: true
        });
        await setCycleRun(tx, id, runId);
        return ok({ runId });
      }),

    startTask: (agencyId: string, userId: string, id: string, key: ClaimTaskKey) =>
      write(agencyId, id, async (tx) => {
        const claim = await lockClaim(tx, agencyId, id);
        if (!claim) return notFound;
        const blocked = unchangeable(claim.status);
        if (blocked && !(claim.status === 'draft' && CLAIM_TASKS[key].onDrafts)) return blocked;
        const [version] = await findPublishedGraphs(tx, agencyId, [{ key, version: 1 }]);
        if (!version) return unpublished(key);
        const runId = await startRun(tx, boss, {
          agencyId,
          versionId: version.id,
          inputs: { claimId: id, assignee: userId },
          interactive: true,
          startedBy: userId
        });
        return ok({ runId });
      })
  };
};

export type ClaimService = ReturnType<typeof createClaimService>;
