import { randomUUID } from 'node:crypto';
import {
  checkFactsOf,
  DOCUMENT_KINDS,
  type DocumentKind,
  isDocumentContentType,
  ledgerFactsOf,
  readClaimStep,
  readIssues
} from '@ugula/billing';
import {
  applyClaimEdit,
  type ClaimEdit,
  type CoverageRow,
  type Db,
  findClaimCheck,
  findPublishedGraphs,
  listCoverages,
  lockClaim,
  nudgeClaim,
  postClaimResponse,
  startRun,
  unchangeable
} from '@ugula/db';
import type { RunQueueClient } from '@ugula/run-queue';
import type { BlobRef, BlobStore } from '@ugula/storage';
import { safeName, type UploadedFile } from '../../shared/files.ts';
import { listLedgerEvents } from '../../shared/ledger.ts';
import { type Announce, announced } from '../../shared/live.ts';
import type { PageRequest } from '../../shared/paging.ts';
import { fail, ok, type Result } from '../../shared/result.ts';
import type { RuleRunner } from '../../shared/rules.ts';
import {
  assignFacility,
  type ClaimFilters,
  claimExists,
  findClaim,
  findClaimDocument,
  findEventDocument,
  hasActiveRun,
  insertClaimDocument,
  insertDocumentEvent,
  listClaimDocuments,
  listClaimEvents,
  listClaimFiles,
  listClaimPayerFiles,
  listClaims,
  type PayerOrder,
  reorderCoverages,
  setCycleRun
} from './queries.ts';
import type {
  BillingData,
  ChaseRequest,
  ClaimEventSort,
  ClaimResponse,
  PayerEntry,
  RecordsRequest
} from './schemas.ts';

type ClaimServiceDeps = {
  db: Db;
  boss: RunQueueClient;
  now: () => Date;
  blobs: Pick<BlobStore, 'getBytes' | 'putBytes'>;
  announce: Announce;
  rules: RuleRunner;
  maxBytes: number;
};

type NewDocument = { kind: DocumentKind; signedOn: string | null; file: UploadedFile };

export const NEXT_CLAIM_STEP_RULE = 'billing.next-claim-step';

export const CLAIM_CHECKS_RULE = 'billing.claim-checks';

const CYCLE_WORKFLOW = { key: 'billing.cycle-claim', version: 1 };

const RECORDS_WORKFLOW = { key: 'billing.respond-records-request', version: 1 };
const RECEIVE_DOCUMENT_WORKFLOW = { key: 'billing.receive-document', version: 1 };

const CHASE_DOCUMENT_WORKFLOW = { key: 'billing.chase-document', version: 1 };

export const documentKey = (agencyId: string, claimId: string, name: string) =>
  `documents/${agencyId}/${claimId}/${randomUUID()}/${safeName(name)}`;

const unpublished = (key: string) => fail('not_found', `The ${key} workflow is not published`);

const notFound = fail('not_found', 'Claim not found');

export const planPayerOrder = (
  existing: readonly CoverageRow[],
  payers: readonly PayerEntry[]
): PayerOrder & { removed: CoverageRow[] } => {
  const byName = new Map(existing.map((c) => [c.payer.toLowerCase(), c]));
  const keep: PayerOrder['keep'] = [];
  const add: PayerOrder['add'] = [];
  payers.forEach(({ name, ...insured }, i) => {
    const found = byName.get(name.toLowerCase());
    if (found) keep.push({ id: found.id, position: i + 1 });
    else add.push({ payer: name, position: i + 1, ...insured });
  });
  const kept = new Set(keep.map((c) => c.id));
  const removed = existing.filter((c) => !kept.has(c.id));
  return { keep, add, remove: removed.map((c) => c.id), removed };
};

const claimEdit = (data: BillingData): ClaimEdit => ({
  serviceDate: data.serviceDate,
  tripType: null,
  level: null,
  emergency: null,
  loadedMiles: null,
  deceased: null,
  nonCoveredMiles: null,
  diagnoses: data.diagnoses,
  pickup: data.pickup,
  destination: data.destination,
  originDestination: data.originDestination,
  documentation: data.documentation,
  patientAddress: data.patient,
  coverages: data.coverages.map((c) => ({
    coverageId: c.id,
    payerId: null,
    memberId: c.memberId,
    groupId: c.groupId,
    relationship: c.relationship,
    insuredFirstName: c.insuredFirstName,
    insuredLastName: c.insuredLastName,
    remove: c.remove
  })),
  newCoverage: null,
  lines: null,
  note: data.note
});

export const createClaimService = ({
  db,
  boss,
  now,
  blobs,
  announce,
  rules,
  maxBytes
}: ClaimServiceDeps) => {
  const write = <T>(agencyId: string, id: string, work: (tx: Db) => Promise<Result<T>>) =>
    announced(announce, agencyId, db.transaction().execute(work), () => [{ kind: 'claim', id }]);
  const nudge = (tx: Db, agencyId: string, claimId: string) =>
    nudgeClaim(tx, boss, agencyId, claimId);

  return {
    list: async (agencyId: string, filters: ClaimFilters) =>
      ok(await listClaims(db, agencyId, filters)),

    find: async (agencyId: string, id: string) => {
      const claim = await findClaim(db, agencyId, id);
      if (!claim) return notFound;
      const open = unchangeable(claim.status) === null;
      const [files, payerFiles, documents, events, check] = await Promise.all([
        listClaimFiles(db, id),
        listClaimPayerFiles(db, id),
        listClaimDocuments(db, id),
        open ? listLedgerEvents(db, id) : [],
        findClaimCheck(db, agencyId, id)
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
        progress: step && ledger ? readClaimStep(step, ledger) : null,
        issues: readIssues(checked?.issues)
      });
    },

    events: async (agencyId: string, id: string, page: PageRequest<ClaimEventSort>) =>
      (await claimExists(db, agencyId, id)) ? ok(await listClaimEvents(db, id, page)) : notFound,

    setPayers: (agencyId: string, id: string, payers: PayerEntry[]) =>
      write(agencyId, id, async (tx) => {
        const claim = await lockClaim(tx, agencyId, id);
        if (!claim) return notFound;
        const blocked = unchangeable(claim.status);
        if (blocked) return blocked;
        const order = planPayerOrder(await listCoverages(tx, id), payers);
        const active = order.removed.find((c) => c.has_events);
        if (active) {
          return fail(
            'conflict',
            `${active.payer} already has billing activity on this claim, so it cannot be removed`
          );
        }
        await reorderCoverages(tx, agencyId, id, order);
        await nudge(tx, agencyId, id);
        return ok({ payers: payers.map((p) => p.name) });
      }),

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

    uploadDocument: async (agencyId: string, userId: string, id: string, d: NewDocument) => {
      if (!d.file.bytes.byteLength) return fail('invalid', 'The file is empty');
      if (d.file.bytes.byteLength > maxBytes) {
        return fail('invalid', `The file is larger than ${maxBytes} bytes`);
      }
      if (!isDocumentContentType(d.file.type)) {
        return fail('invalid', 'Upload the document as a PDF, PNG, JPEG or TIFF file');
      }
      if (!(await claimExists(db, agencyId, id))) return notFound;
      const [version] = await findPublishedGraphs(db, agencyId, [RECEIVE_DOCUMENT_WORKFLOW]);
      if (!version) return unpublished(RECEIVE_DOCUMENT_WORKFLOW.key);
      const fileName = d.file.name.trim() || safeName(d.file.name);
      const document = await blobs.putBytes(
        documentKey(agencyId, id, fileName),
        d.file.bytes,
        d.file.type
      );
      return write(agencyId, id, async (tx) => {
        const saved = await insertClaimDocument(tx, {
          agencyId,
          claimId: id,
          kind: d.kind,
          fileName,
          document,
          signedOn: d.signedOn,
          uploadedBy: userId
        });
        await insertDocumentEvent(
          tx,
          id,
          `${DOCUMENT_KINDS[d.kind]} uploaded: ${fileName}`,
          userId
        );
        const runId = await startRun(tx, boss, {
          agencyId,
          versionId: version.id,
          inputs: { claimId: id, documentId: saved.id },
          interactive: true
        });
        return ok({ id: saved.id, runId });
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

    chaseDocument: (agencyId: string, id: string, chase: ChaseRequest) =>
      write(agencyId, id, async (tx) => {
        if (!(await claimExists(tx, agencyId, id))) return notFound;
        const [version] = await findPublishedGraphs(tx, agencyId, [CHASE_DOCUMENT_WORKFLOW]);
        if (!version) return unpublished(CHASE_DOCUMENT_WORKFLOW.key);
        const runId = await startRun(tx, boss, {
          agencyId,
          versionId: version.id,
          inputs: { claimId: id, kind: chase.kind, note: chase.note },
          interactive: true
        });
        return ok({ runId });
      }),

    saveBillingData: (agencyId: string, userId: string, id: string, data: BillingData) =>
      write(agencyId, id, async (tx) => {
        const claim = await lockClaim(tx, agencyId, id);
        if (!claim) return notFound;
        const blocked = unchangeable(claim.status);
        if (blocked) return blocked;
        const coverages = new Map((await listCoverages(tx, id)).map((c) => [c.id, c]));
        if (data.coverages.some((c) => !coverages.has(c.id))) {
          return fail('invalid', 'A coverage is not on this claim');
        }
        const active = data.coverages.find((c) => c.remove && coverages.get(c.id)?.has_events);
        if (active) {
          return fail(
            'conflict',
            `${coverages.get(active.id)?.payer} already has billing activity on this claim, so it cannot be removed`
          );
        }
        await applyClaimEdit(tx, agencyId, id, claimEdit(data), {
          sourceKey: null,
          createdBy: userId
        });
        await nudge(tx, agencyId, id);
        return ok({ status: 'saved' });
      }),

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

    requestRecords: (agencyId: string, id: string, request: RecordsRequest) =>
      write(agencyId, id, async (tx) => {
        const claim = await lockClaim(tx, agencyId, id);
        if (!claim) return notFound;
        const blocked = unchangeable(claim.status);
        if (blocked) return blocked;
        const [version] = await findPublishedGraphs(tx, agencyId, [RECORDS_WORKFLOW]);
        if (!version) return fail('not_found', 'The records request workflow is not published');
        const runId = await startRun(tx, boss, {
          agencyId,
          versionId: version.id,
          inputs: { claimId: id, dueOn: request.dueOn, note: request.note },
          interactive: true
        });
        return ok({ runId });
      }),

    setFacility: (agencyId: string, id: string, facilityId: string | null) =>
      write(agencyId, id, async (tx) => {
        const claim = await lockClaim(tx, agencyId, id);
        if (!claim) return notFound;
        const blocked = unchangeable(claim.status);
        if (blocked) return blocked;
        if (!(await assignFacility(tx, agencyId, id, facilityId))) {
          return fail('invalid', 'That facility is not in this agency');
        }
        await nudge(tx, agencyId, id);
        return ok({ facilityId });
      }),

    recordResponse: (agencyId: string, userId: string, id: string, response: ClaimResponse) =>
      write(agencyId, id, (tx) => postClaimResponse(tx, boss, agencyId, id, userId, response))
  };
};

export type ClaimService = ReturnType<typeof createClaimService>;
