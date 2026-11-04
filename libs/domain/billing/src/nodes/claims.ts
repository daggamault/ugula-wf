import { actionNode, branchNode, type PinSpec, pin } from '@ugula/graph';
import { priceLines, readLines, readPricedLines } from '../charges.ts';
import { CLAIM_FIX_FIELDS, changesCharges, fixForm, readClaimPatch } from '../claim-fix.ts';
import {
  type ClaimCheck,
  type ClaimIssue,
  claimIssues,
  isBlocking,
  readNewClaim
} from '../claim-validation.ts';
import { type ClaimLedger, claimProgress, RESTARTABLE_STATUSES } from '../claims.ts';
import { BLOB, CLAIM, CLAIM_ISSUE, LINE, PATIENT, SERVICE } from '../models.ts';
import { isCents, recordOf, requiredText, textOrNull } from '../values.ts';
import type { NodesOf } from './stores.ts';

const CATEGORY = 'Billing';

export const claimIdPin = pin('claimId', 'string');

export const claimIdOf = (x: unknown) => requiredText(x, 'No claim to work on');

const claimPin = pin('claim', CLAIM.type);

export const issuesPin = pin('issues', { list: CLAIM_ISSUE.type });

const pricedLinesPin = pin('lines', { list: LINE.type });

const PAYER_FIELDS: readonly ClaimIssue['field'][] = ['payers', 'payer', 'memberId', 'insured'];

export const relevantIssues = (
  issues: ClaimIssue[],
  ledger: ClaimLedger | null,
  patientOnly = false
) => {
  const skipped = new Set(ledger ? claimProgress(ledger).skipped : []);
  return issues.filter((i) =>
    patientOnly
      ? !PAYER_FIELDS.includes(i.field)
      : i.coverageId === null || !skipped.has(i.coverageId)
  );
};

export const checkOf = (check: ClaimCheck | null, claimId: string) => {
  if (!check) throw new Error(`Claim ${claimId} does not exist`);
  return check;
};

const fixPins: PinSpec[] = CLAIM_FIX_FIELDS.map((f) =>
  pin(f.name, f.type, { optional: true, ...(f.label ? { label: f.label } : {}) })
);

const dollarsToCents = (x: number) => Math.round(x * 100);

export const claimNodes: NodesOf = (stores) => {
  const claims = () => stores().claims;
  return [
    branchNode({
      type: 'billing.price-claim',
      title: 'Price Claim',
      category: CATEGORY,
      description:
        "Prices HCPCS claim lines from the tenant's fee schedule, using the directory payer's prices where they exist and any prices a biller set for this claim first. Continues through unpriced with the codes that have no fee.",
      inputs: [
        pin('lines', { list: { object: { code: 'string', units: 'number' } } }),
        pin('payerId', 'string', { optional: true }),
        pin('fees', { object: {} }, { optional: true, label: 'Prices set for this claim (cents)' })
      ],
      outputs: [pricedLinesPin, pin('totalCents', 'integer'), pin('missing', { list: 'string' })],
      exits: ['priced', 'unpriced'],
      compute: async (inputs, _, ctx) => {
        const lines = readLines(inputs.lines);
        const scheduled = await stores().fees.findFees(ctx.runId, textOrNull(inputs.payerId), [
          ...new Set(lines.map((l) => l.code))
        ]);
        const set = Object.fromEntries(
          Object.entries(recordOf(inputs.fees)).filter((e): e is [string, number] => isCents(e[1]))
        );
        const priced = priceLines(lines, { ...scheduled, ...set });
        return { exit: priced.missing.length ? 'unpriced' : 'priced', outputs: priced };
      }
    }),
    actionNode({
      type: 'billing.set-fee',
      title: 'Set Fee',
      category: CATEGORY,
      description:
        "Adds a biller's price for a code to the prices set for this claim, and with saveToSchedule also to the agency's default fee schedule, so later claims are priced with it.",
      effect: true,
      inputs: [
        pin('code', 'string'),
        pin('unitPrice', 'number', { label: 'Unit price (dollars)' }),
        pin('saveToSchedule', 'boolean', { optional: true }),
        pin('fees', { object: {} }, { optional: true })
      ],
      outputs: [pin('fees', { object: {} })],
      compute: async (inputs, _, ctx) => {
        const code = requiredText(inputs.code, 'No code to price');
        if (inputs.unitPrice < 0) throw new Error('A price cannot be negative');
        const cents = dollarsToCents(inputs.unitPrice);
        if (inputs.saveToSchedule === true)
          await stores().fees.saveFee(ctx.runId, null, code, cents);
        return { fees: { ...recordOf(inputs.fees), [code]: cents } };
      }
    }),
    branchNode({
      type: 'billing.validate-claim',
      title: 'Validate Claim',
      category: CATEGORY,
      description:
        'Checks the saved claim with the same checks as submission: patient and address, date of service, trip type, service, charges, diagnoses, pickup and destination, origin/destination modifier, miles, and each payer still to bill. Continues through invalid when anything blocks it. Also outputs the fields, current values and choices a Fix Claim Data task needs; with all, every field.',
      inputs: [claimIdPin, pin('all', 'boolean', { optional: true })],
      outputs: [
        issuesPin,
        pin('visible', { list: 'string' }),
        pin('defaults', { object: {} }),
        pin('options', { object: {} })
      ],
      exits: ['valid', 'invalid'],
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const store = claims();
        const [check, ledger, directory] = await Promise.all([
          store.claimCheck(ctx.runId, claimId).then((c) => checkOf(c, claimId)),
          store.ledger(ctx.runId, claimId),
          stores().payers.directory(ctx.runId)
        ]);
        const issues = relevantIssues(claimIssues(check, ctx.now), ledger);
        return {
          exit: isBlocking(issues) ? 'invalid' : 'valid',
          outputs: { issues, ...fixForm(check, issues, directory, inputs.all === true) }
        };
      }
    }),
    branchNode({
      type: 'billing.patch-claim',
      title: 'Patch Claim',
      category: CATEGORY,
      description:
        'Applies what a biller entered in a Fix Claim Data task to the claim, once per run step, leaving empty fields as they are, and logs the edit so an approved claim is reviewed again. Continues through reprice when the trip type, service, miles or payers changed, with what the charges are mapped and priced from; lines saves repriced charges.',
      effect: true,
      inputs: [claimIdPin, ...fixPins, pin('lines', { list: LINE.type }, { optional: true })],
      outputs: [pin('tripType', 'string'), pin('service', SERVICE.type), pin('payerId', 'string')],
      exits: ['patched', 'reprice'],
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const store = claims();
        const before = checkOf(await store.claimCheck(ctx.runId, claimId), claimId);
        const patch = {
          ...readClaimPatch(inputs, before),
          lines: inputs.lines ? readPricedLines(inputs.lines) : null
        };
        await store.patchClaim(ctx.runId, claimId, ctx.key, patch);
        if (!changesCharges(patch)) {
          return { exit: 'patched', outputs: { tripType: null, service: null, payerId: null } };
        }
        const after = checkOf(await store.claimCheck(ctx.runId, claimId), claimId);
        return {
          exit: 'reprice',
          outputs: {
            tripType: after.tripType,
            service: {
              level: after.level,
              emergency: after.emergency,
              loadedMiles: after.loadedMiles,
              basis: []
            },
            payerId: after.payers[0]?.payerId ?? null
          }
        };
      }
    }),
    branchNode({
      type: 'billing.open-claim',
      title: 'Open Draft Claim',
      category: CATEGORY,
      description:
        'Opens a draft claim for an encounter as soon as its report arrives, linked to the report and to this run, so billers see it and every task it needs while it is worked. With claimId, works that claim again from this report instead (a restart, or reopening a void). Once per run step. Continues through duplicate with the existing claim when its PCR number was already billed.',
      effect: true,
      inputs: [
        pin('pcrNumber', 'string', { optional: true }),
        pin('report', BLOB, { optional: true }),
        pin('claimId', 'string', { optional: true })
      ],
      outputs: [claimIdPin],
      exits: ['opened', 'duplicate'],
      compute: async (inputs, _, ctx) => {
        const { id, duplicate } = await claims().openDraft(ctx.runId, ctx.key, {
          pcrNumber: textOrNull(inputs.pcrNumber),
          reportKey: textOrNull(inputs.report?.key),
          claimId: textOrNull(inputs.claimId)
        });
        return { exit: duplicate ? 'duplicate' : 'opened', outputs: { claimId: id } };
      }
    }),
    actionNode({
      type: 'billing.assign-patient',
      title: 'Assign Patient',
      category: CATEGORY,
      description: 'Sets the patient on a draft claim once the report patient is resolved.',
      effect: true,
      inputs: [claimIdPin, pin('patient', PATIENT.type)],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const patientId = requiredText(recordOf(inputs.patient).id, 'The patient has no id');
        await claims().assignPatient(ctx.runId, claimId, ctx.key, patientId);
        return {};
      }
    }),
    actionNode({
      type: 'billing.save-claim',
      title: 'Save Claim',
      category: CATEGORY,
      description:
        'Fills the draft claim with its trip type, charge lines, payers in billing order, trip details and diagnoses. It stays a draft until it is valid and its payer cycle starts.',
      effect: true,
      inputs: [claimIdPin, claimPin],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        await claims().saveClaim(ctx.runId, claimId, ctx.key, readNewClaim(inputs.claim));
        return {};
      }
    }),
    branchNode({
      type: 'billing.note-revision',
      title: 'Note PCR Revision',
      category: CATEGORY,
      description:
        'Logs on a claim that an updated version of its patient care report arrived, with the new report attached. Once per run step. Continues through restartable while the claim can still be worked again from the new report (draft, needs review or void), else through billed, with the report it was billed from.',
      effect: true,
      inputs: [claimIdPin, pin('report', BLOB)],
      outputs: [pin('status', 'string'), pin('previous', BLOB)],
      exits: ['restartable', 'billed'],
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const report = {
          bucket: requiredText(inputs.report.bucket, 'The revised report needs a bucket'),
          key: requiredText(inputs.report.key, 'The revised report needs a key')
        };
        const { status, previous } = await claims().noteRevision(
          ctx.runId,
          claimId,
          ctx.key,
          report
        );
        return {
          exit: (RESTARTABLE_STATUSES as readonly string[]).includes(status)
            ? 'restartable'
            : 'billed',
          outputs: { status, previous }
        };
      }
    })
  ];
};
