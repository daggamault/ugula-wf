import { actionNode, branchNode, type PinSpec, pin, pureNode } from '@ugula/graph';
import { priceLines, readLines, readPricedLines } from '../charges.ts';
import { CLAIM_FIX_FIELDS, chargeChanges, fixForm, readClaimPatch } from '../claim-fix.ts';
import { type ClaimCheck, checkFactsOf, readIssues, readNewClaim } from '../claim-validation.ts';
import { claimProgress, RESTARTABLE_STATUSES } from '../claims.ts';
import { BLOB, CHECK_FACTS, CLAIM, CLAIM_ISSUE, LINE, PATIENT, SERVICE } from '../models.ts';
import { isCents, recordOf, requiredText, textOrNull } from '../values.ts';
import type { NodesOf } from './stores.ts';

const CATEGORY = 'Billing';

export const claimIdPin = pin('claimId', 'string');

export const claimIdOf = (x: unknown) => requiredText(x, 'No claim to work on');

const claimPin = pin('claim', CLAIM.type);

export const issuesPin = pin('issues', { list: CLAIM_ISSUE.type });

const pricedLinesPin = pin('lines', { list: LINE.type });

const CHARGE_LINES = { list: { object: { code: 'string', units: 'number' } } } as const;

const FEES = { object: {} } as const;

export const checkOf = (check: ClaimCheck | null, claimId: string) => {
  if (!check) throw new Error(`Claim ${claimId} does not exist`);
  return check;
};

const fixPins: PinSpec[] = CLAIM_FIX_FIELDS.map((f) =>
  pin(f.name, f.type, { optional: true, ...(f.label ? { label: f.label } : {}) })
);

const dollarsToCents = (x: number) => Math.round(x * 100);

const centsOf = (x: unknown) =>
  Object.fromEntries(
    Object.entries(recordOf(x)).filter((e): e is [string, number] => isCents(e[1]))
  );

export const claimNodes: NodesOf = (stores) => {
  const claims = () => stores().claims;
  return [
    actionNode({
      type: 'billing.find-fees',
      title: 'Find Fees',
      category: CATEGORY,
      description:
        "Reads the agency's fee schedules for the codes on the lines: the directory payer's own prices, and the default prices every payer falls back to. Which price wins is the Price Precedence rule.",
      inputs: [pin('lines', CHARGE_LINES), pin('payerId', 'string', { optional: true })],
      outputs: [
        pin('payerFees', FEES, { label: 'Payer Prices (Cents)' }),
        pin('defaultFees', FEES, { label: 'Default Prices (Cents)' })
      ],
      compute: async (inputs, _, ctx) => {
        const codes = [...new Set(readLines(inputs.lines).map((l) => l.code))];
        const found = await stores().fees.findSchedules(
          ctx.runId,
          textOrNull(inputs.payerId),
          codes
        );
        return { payerFees: found.payer, defaultFees: found.default };
      }
    }),
    pureNode({
      type: 'billing.price-lines',
      title: 'Price Lines',
      category: CATEGORY,
      description:
        'Prices HCPCS lines at the unit price chosen for each code, rounding each line to the cent, and lists the codes that have no price.',
      inputs: [pin('lines', CHARGE_LINES), pin('fees', FEES, { label: 'Unit Prices (Cents)' })],
      outputs: [pricedLinesPin, pin('totalCents', 'integer'), pin('missing', { list: 'string' })],
      compute: (inputs) => priceLines(readLines(inputs.lines), centsOf(inputs.fees))
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
        pin('unitPrice', 'number', { label: 'Unit Price (Dollars)' }),
        pin('saveToSchedule', 'boolean', { optional: true }),
        pin('fees', FEES, { optional: true })
      ],
      outputs: [pin('fees', FEES)],
      compute: async (inputs, _, ctx) => {
        const code = requiredText(inputs.code, 'No code to price');
        if (inputs.unitPrice < 0) throw new Error('A price cannot be negative');
        const cents = dollarsToCents(inputs.unitPrice);
        if (inputs.saveToSchedule === true)
          await stores().fees.saveFee(ctx.runId, null, code, cents);
        return { fees: { ...recordOf(inputs.fees), [code]: cents } };
      }
    }),
    actionNode({
      type: 'billing.read-claim-checks',
      title: 'Read Claim for Checks',
      category: CATEGORY,
      description:
        'Loads the saved claim as the check rules read it (Check Facts): patient, trip, charges, diagnoses, places, documentation and each payer, with the days a certification was signed before the trip and the days left to file worked out. Also outputs the claim for task details and the payers already skipped, whose issues no longer matter.',
      inputs: [claimIdPin],
      outputs: [
        pin('facts', CHECK_FACTS.type),
        pin('claim', { object: {} }),
        pin('skipped', { list: 'string' }, { label: 'Skipped Payers' })
      ],
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const [check, ledger] = await Promise.all([
          claims()
            .claimCheck(ctx.runId, claimId)
            .then((c) => checkOf(c, claimId)),
          claims().ledger(ctx.runId, claimId)
        ]);
        return {
          facts: checkFactsOf(check, ctx.now),
          claim: check,
          skipped: ledger ? claimProgress(ledger).skipped : []
        };
      }
    }),
    actionNode({
      type: 'billing.fix-claim-form',
      title: 'Fix Claim Form',
      category: CATEGORY,
      description:
        'Lays out a Fix Claim Data task: the fields the issues name (each issue says its field), with their current values and the payer and directory choices; with all, every field.',
      inputs: [claimIdPin, issuesPin, pin('all', 'boolean', { optional: true })],
      outputs: [
        pin('visible', { list: 'string' }),
        pin('defaults', { object: {} }),
        pin('options', { object: {} })
      ],
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const [check, directory] = await Promise.all([
          claims()
            .claimCheck(ctx.runId, claimId)
            .then((c) => checkOf(c, claimId)),
          stores().payers.directory(ctx.runId)
        ]);
        return fixForm(check, readIssues(inputs.issues), directory, inputs.all === true);
      }
    }),
    actionNode({
      type: 'billing.patch-claim',
      title: 'Patch Claim',
      category: CATEGORY,
      description:
        'Applies what a biller entered in a Fix Claim Data task to the claim, once per run step, leaving empty fields as they are, and logs the edit so an approved claim is reviewed again; lines saves repriced charges. Outputs what changed (trip type, level, emergency, miles, payers), for the Reprice Triggers rule, and the trip type, service and primary payer charges are mapped and priced from.',
      effect: true,
      inputs: [claimIdPin, ...fixPins, pin('lines', { list: LINE.type }, { optional: true })],
      outputs: [
        pin('changes', { object: {} }, { label: 'What Changed' }),
        pin('tripType', 'string'),
        pin('service', SERVICE.type),
        pin('payerId', 'string')
      ],
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const store = claims();
        const before = checkOf(await store.claimCheck(ctx.runId, claimId), claimId);
        const patch = {
          ...readClaimPatch(inputs, before),
          lines: inputs.lines ? readPricedLines(inputs.lines) : null
        };
        await store.patchClaim(ctx.runId, claimId, ctx.key, patch);
        const after = checkOf(await store.claimCheck(ctx.runId, claimId), claimId);
        return {
          changes: chargeChanges(patch),
          tripType: after.tripType,
          service: {
            level: after.level,
            emergency: after.emergency,
            loadedMiles: after.loadedMiles,
            basis: []
          },
          payerId: after.payers[0]?.payerId ?? null
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
