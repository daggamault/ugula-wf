import { actionNode, branchNode, pin } from '@ugula/graph';
import { priceLines, readLines } from '../charges.ts';
import { claimProblems, readNewClaim } from '../claim-validation.ts';
import { CLAIM, PATIENT } from '../models.ts';
import { recordOf, requiredText, textOrNull } from '../values.ts';
import type { NodesOf } from './stores.ts';

const CATEGORY = 'Billing';

const BLOB = { object: { bucket: 'string', key: 'string' } } as const;

const claimIdPin = pin('claimId', 'string');

const claimPin = pin('claim', CLAIM.type);

const noClaim = 'No claim to work on';

export const claimNodes: NodesOf = (stores) => {
  const claims = () => stores().claims;
  return [
    actionNode({
      type: 'billing.price-claim',
      title: 'Price Claim',
      category: CATEGORY,
      description:
        "Prices HCPCS claim lines from the tenant's fee schedule, using the directory payer's prices where they exist.",
      inputs: [
        pin('lines', { list: { object: { code: 'string', units: 'number' } } }),
        pin('payerId', 'string', { optional: true })
      ],
      outputs: [
        pin('lines', {
          list: {
            object: { code: 'string', units: 'number', unitCents: 'integer', totalCents: 'integer' }
          }
        }),
        pin('totalCents', 'integer')
      ],
      compute: async (inputs, _, ctx) => {
        const lines = readLines(inputs.lines);
        const fees = await stores().fees.findFees(ctx.runId, textOrNull(inputs.payerId), [
          ...new Set(lines.map((l) => l.code))
        ]);
        return priceLines(lines, fees);
      }
    }),
    branchNode({
      type: 'billing.validate-claim',
      title: 'Validate Claim',
      category: CATEGORY,
      description:
        'Checks a claim has everything it needs to be saved: a patient, a level of service, priced lines that add up to the total, and a date of service. Continues through invalid with the problems, so a person can sort them out.',
      inputs: [claimPin],
      outputs: [pin('issues', { list: 'string' })],
      exits: ['valid', 'invalid'],
      compute: (inputs) => {
        const issues = claimProblems(inputs.claim);
        return { exit: issues.length ? 'invalid' : 'valid', outputs: { issues } };
      }
    }),
    branchNode({
      type: 'billing.open-claim',
      title: 'Open Draft Claim',
      category: CATEGORY,
      description:
        'Opens a draft claim for an encounter as soon as its report arrives, linked to the report and to this run, so billers see it and every task it needs while it is worked. Once per run step. Continues through duplicate with the existing claim when its PCR number was already billed.',
      effect: true,
      inputs: [
        pin('pcrNumber', 'string', { optional: true }),
        pin('report', BLOB, { optional: true })
      ],
      outputs: [claimIdPin],
      exits: ['opened', 'duplicate'],
      compute: async (inputs, _, ctx) => {
        const { id, duplicate } = await claims().openDraft(ctx.runId, ctx.key, {
          pcrNumber: textOrNull(inputs.pcrNumber),
          reportKey: textOrNull(inputs.report?.key)
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
        const claimId = requiredText(inputs.claimId, noClaim);
        const patientId = requiredText(recordOf(inputs.patient).id, 'The patient has no id');
        await claims().assignPatient(ctx.runId, claimId, patientId);
        return {};
      }
    }),
    actionNode({
      type: 'billing.save-claim',
      title: 'Save Claim',
      category: CATEGORY,
      description:
        'Fills a draft claim with its charge lines, payers in billing order, trip details and diagnoses, and moves it to review.',
      effect: true,
      inputs: [claimIdPin, claimPin],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        const claimId = requiredText(inputs.claimId, noClaim);
        await claims().saveClaim(ctx.runId, claimId, readNewClaim(inputs.claim));
        return {};
      }
    }),
    actionNode({
      type: 'billing.note-revision',
      title: 'Note PCR Revision',
      category: CATEGORY,
      description:
        'Logs on a claim that an updated version of its patient care report arrived, with the new report attached. Once per run step.',
      effect: true,
      inputs: [claimIdPin, pin('report', BLOB)],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        const claimId = requiredText(inputs.claimId, noClaim);
        const report = {
          bucket: requiredText(inputs.report.bucket, 'The revised report needs a bucket'),
          key: requiredText(inputs.report.key, 'The revised report needs a key')
        };
        await claims().noteRevision(ctx.runId, claimId, ctx.key, report);
        return {};
      }
    })
  ];
};
