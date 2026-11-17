import { actionNode, branchNode, type PinSpec, pin, pureNode } from '@ugula/graph';
import { priceLines, readLines, readPricedLines } from '../charges.ts';
import { CLAIM_DOCUMENT, CLAIM_ISSUE, CLAIM_RECORD } from '../check-models.ts';
import { chargeChanges, editedValues, readClaimPatch } from '../claim-fix.ts';
import { CLAIM_FIX_FIELDS } from '../claim-fix-fields.ts';
import { fixForm } from '../claim-fix-form.ts';
import { CLAIM, LINE, SERVICE } from '../claim-models.ts';
import { type ClaimCheck, claimRecordOf, readIssues, readNewClaim } from '../claim-validation.ts';
import { claimProgress } from '../claims.ts';
import { FACILITY_KINDS, isResponsibleParty } from '../facilities.ts';
import { BLOB } from '../model-kit.ts';
import { PATIENT } from '../party-models.ts';
import { isCents, recordOf, requiredText, textOrNull } from '../values.ts';
import type { NodesOf } from './stores.ts';

const CATEGORY = 'Billing';

export const claimIdPin = pin(
  'claimId',
  { id: 'claim' },
  { label: 'Claim', description: 'The claim being worked.' }
);

export const claimIdOf = (x: unknown) => requiredText(x, 'No claim to work on');

const claimPin = pin('claim', CLAIM.type, {
  description: 'The claim to save: classification, lines, payers, trip and diagnoses.'
});

const issuesPin = pin(
  'issues',
  { list: CLAIM_ISSUE.type },
  {
    description: 'The issues the checks found, each naming the field to fix.'
  }
);

const pricedLinesPin = pin(
  'lines',
  { list: LINE.type },
  {
    label: 'Priced Lines',
    description: 'The charge lines with their unit price and line total.'
  }
);

const CHARGE_LINES = { list: { object: { code: { code: 'hcpcs' }, units: 'number' } } } as const;

const chargeLinesPin = pin('lines', CHARGE_LINES, {
  label: 'Charge Lines',
  description: 'The HCPCS codes and units to charge.'
});

const FEES = { object: {} } as const;

const checkOf = (check: ClaimCheck | null, claimId: string) => {
  if (!check) throw new Error(`Claim ${claimId} does not exist`);
  return check;
};

const fixPins: PinSpec[] = CLAIM_FIX_FIELDS.map((f) =>
  pin(f.name, f.type, {
    optional: true,
    description: f.label
      ? `${f.label}, as the biller entered it.`
      : 'A claim field the biller entered.'
  })
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
      level: 'basic',
      keywords: ['price', 'fee schedule', 'charges'],
      inputs: [
        chargeLinesPin,
        pin(
          'payerId',
          { id: 'payer' },
          {
            optional: true,
            label: 'Payer',
            description: 'The directory payer whose own prices to read, if any.'
          }
        )
      ],
      outputs: [
        pin('payerFees', FEES, {
          label: 'Payer Prices (Cents)',
          description: "The payer's own price per code, in cents."
        }),
        pin('defaultFees', FEES, {
          label: 'Default Prices (Cents)',
          description: 'The default price per code every payer falls back to, in cents.'
        })
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
        'Prices HCPCS lines at the unit price chosen for each code for the units given, rounding each line total to the cent, and lists the codes that have no price.',
      level: 'basic',
      keywords: ['price', 'charges', 'total'],
      inputs: [
        chargeLinesPin,
        pin('fees', FEES, {
          label: 'Unit Prices (Cents)',
          description: 'The unit price to charge per code, in cents.'
        })
      ],
      outputs: [
        pricedLinesPin,
        pin('totalCents', 'integer', {
          label: 'Total (Cents)',
          description: 'The sum of the line totals, in cents.'
        }),
        pin(
          'missing',
          { list: { code: 'hcpcs' } },
          {
            label: 'Codes Without a Price',
            description: 'The codes that have no price, so their lines are not priced.'
          }
        )
      ],
      compute: (inputs) => priceLines(readLines(inputs.lines), centsOf(inputs.fees))
    }),
    actionNode({
      type: 'billing.set-fee',
      title: 'Set Fee',
      category: CATEGORY,
      description:
        "Adds a biller's price for a code to the prices set for this claim and, when asked, also to the agency's default fee schedule, so later claims are priced with it.",
      level: 'basic',
      keywords: ['price', 'fee schedule'],
      effect: true,
      inputs: [
        pin('code', { code: 'hcpcs' }, { label: 'Code', description: 'The HCPCS code to price.' }),
        pin('unitPrice', 'number', {
          label: 'Unit Price (Dollars)',
          description: 'The price of one unit, in dollars.'
        }),
        pin('saveToSchedule', 'boolean', {
          optional: true,
          label: 'Save to Fee Schedule',
          description: "Also save the price to the agency's default fee schedule."
        }),
        pin('fees', FEES, {
          optional: true,
          label: 'Unit Prices (Cents)',
          description: 'The prices already set for this claim, in cents.'
        })
      ],
      outputs: [
        pin('fees', FEES, {
          label: 'Unit Prices (Cents)',
          description: 'The prices set for this claim, with this one added, in cents.'
        })
      ],
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
      type: 'billing.read-claim',
      title: 'Read Claim',
      category: CATEGORY,
      description:
        'Loads the saved claim as it is stored (Claim Record): patient, trip, charges, diagnoses, places, documentation and each payer, with today in the time zone of the agency. Also gives the claim for task details and the payers already skipped.',
      level: 'basic',
      keywords: ['claim', 'record', 'load', 'check'],
      inputs: [claimIdPin],
      outputs: [
        pin('record', CLAIM_RECORD.type, {
          label: 'Claim Record',
          description: 'The saved claim as it is stored.'
        }),
        pin('claim', { object: {} }, { description: 'The saved claim, for task details.' }),
        pin(
          'skipped',
          { list: { id: 'coverage' } },
          {
            label: 'Skipped Payers',
            description: 'The payers already skipped, whose issues no longer matter.'
          }
        )
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
          record: claimRecordOf(check, ctx.now),
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
        'Lays out a Fix Claim Data task: the fields the issues name, with their current values and the payer and directory choices, or every field when asked.',
      level: 'basic',
      keywords: ['task', 'form', 'fix'],
      inputs: [
        claimIdPin,
        issuesPin,
        pin('all', 'boolean', {
          optional: true,
          label: 'All Fields',
          description: 'Show every field, not just those the issues name.'
        })
      ],
      outputs: [
        pin(
          'visible',
          { list: 'string' },
          {
            label: 'Fields Shown',
            description: 'The fields the task shows.'
          }
        ),
        pin('defaults', { object: {} }, { description: 'The current value of each field.' }),
        pin(
          'options',
          { object: {} },
          { description: 'The choices for fields picked from a list.' }
        )
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
        'Applies what a biller entered in a Fix Claim Data task to the claim, once per step, leaving empty fields and fields unchanged from what the task showed as they are (so a document or answer recorded meanwhile stands), and logs the edit so an approved claim is reviewed again; repriced lines replace the charges. Gives what changed (classification, level, emergency, miles, payers) for the Reprice Triggers rule, and the classification, service and primary payer to map and price charges from.',
      level: 'basic',
      keywords: ['fix', 'edit', 'correct', 'update claim'],
      effect: true,
      inputs: [
        claimIdPin,
        ...fixPins,
        pin(
          'lines',
          { list: LINE.type },
          {
            optional: true,
            label: 'Repriced Lines',
            description: 'Repriced charge lines to save, if the charges changed.'
          }
        ),
        pin(
          'shown',
          { object: {} },
          {
            optional: true,
            label: 'What the Task Showed',
            description: 'The values the task showed, so untouched fields are left alone.'
          }
        )
      ],
      outputs: [
        pin(
          'changes',
          { object: {} },
          {
            label: 'What Changed',
            description: 'Which of classification, level, emergency, miles and payers changed.'
          }
        ),
        pin('classification', 'string', { description: 'The classification after the edit.' }),
        pin('service', SERVICE.type, {
          description: 'The level of service, emergency status and miles after the edit.'
        }),
        pin(
          'payerId',
          { id: 'payer' },
          {
            label: 'Primary Payer',
            description: 'The directory payer billed first after the edit.'
          }
        )
      ],
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const store = claims();
        const before = checkOf(await store.claimCheck(ctx.runId, claimId), claimId);
        const patch = {
          ...readClaimPatch(editedValues(inputs, inputs.shown), before),
          lines: inputs.lines ? readPricedLines(inputs.lines) : null
        };
        await store.patchClaim(ctx.runId, claimId, ctx.key, patch);
        const after = checkOf(await store.claimCheck(ctx.runId, claimId), claimId);
        return {
          changes: chargeChanges(patch),
          classification: after.classification,
          service: {
            level: after.level,
            emergency: after.emergency,
            loadedMiles: after.loadedMiles,
            basis: [],
            deceased: after.deceased,
            nonCoveredMiles: after.nonCoveredMiles
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
        'Opens a draft claim for an encounter as soon as its report arrives, linked to the report and to this run, so billers see it and every task it needs while it is worked. Given a claim, works that claim again from this report instead (a restart, or reopening a void). Once per step.',
      level: 'basic',
      keywords: ['create claim', 'new claim', 'draft'],
      effect: true,
      inputs: [
        pin('pcrNumber', 'string', {
          optional: true,
          label: 'PCR Number',
          description: 'The PCR number of the report, used to spot a report already billed.'
        }),
        pin('report', BLOB, {
          optional: true,
          description: 'The stored patient care report the claim is billed from.'
        }),
        pin(
          'claimId',
          { id: 'claim' },
          {
            optional: true,
            label: 'Claim',
            description: 'A claim to work again from this report, instead of opening a new one.'
          }
        )
      ],
      outputs: [claimIdPin],
      exits: {
        opened: { label: 'Opened', description: 'The draft claim is open to work.' },
        duplicate: {
          label: 'Duplicate',
          description: 'The PCR number was already billed; the claim is the existing one.'
        }
      },
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
      level: 'basic',
      keywords: ['patient', 'link'],
      effect: true,
      inputs: [
        claimIdPin,
        pin('patient', PATIENT.type, {
          description: 'The billing patient the report was matched to.'
        })
      ],
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
        'Fills the draft claim with its classification, charge lines, payers in billing order, trip details and diagnoses. It stays a draft until it is valid and its payer cycle starts.',
      level: 'basic',
      keywords: ['save', 'claim'],
      effect: true,
      inputs: [claimIdPin, claimPin],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        await claims().saveClaim(ctx.runId, claimId, ctx.key, readNewClaim(inputs.claim));
        return {};
      }
    }),
    actionNode({
      type: 'billing.facility-choices',
      title: 'Facility Choices',
      category: CATEGORY,
      description:
        "Lists the agency's facility directory as choices for a task's facility field, with contract facilities marked.",
      level: 'basic',
      keywords: ['facility', 'hospital', 'choices'],
      inputs: [],
      outputs: [
        pin(
          'options',
          { object: {} },
          {
            label: 'Choices',
            description: 'The facility choices, for the facility field of a task.'
          }
        )
      ],
      compute: async (_, __, ctx) => {
        const facilities = await claims().facilityDirectory(ctx.runId);
        return {
          options: facilities.length
            ? {
                facilityId: facilities.map((f) => ({
                  value: f.id,
                  label: `${f.name} · ${FACILITY_KINDS[f.kind]}${f.contract ? ' · contract' : ''}`
                }))
              }
            : null
        };
      }
    }),
    actionNode({
      type: 'billing.record-responsibility',
      title: 'Record Responsible Party',
      category: CATEGORY,
      description:
        'Records who a claim is billed to, once per step, with why: the payers, or a facility (a Part A stay or a contract), which sets the claim to Bill facility and keeps it from going to payers on an 837P.',
      level: 'basic',
      keywords: ['responsible party', 'bill facility', 'part a'],
      effect: true,
      inputs: [
        claimIdPin,
        pin('party', 'string', {
          label: 'Responsible Party',
          description: 'Who the claim is billed to: payer or facility.'
        }),
        pin(
          'facilityId',
          { id: 'facility' },
          {
            optional: true,
            label: 'Facility',
            description: 'The facility billed, when the facility is responsible.'
          }
        ),
        pin('note', 'string', { optional: true, description: 'Why, in words a biller reads.' })
      ],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        if (!isResponsibleParty(inputs.party)) {
          throw new Error(`Unknown responsible party "${String(inputs.party)}"`);
        }
        await claims().setResponsibility(ctx.runId, claimId, ctx.key, {
          party: inputs.party,
          facilityId: inputs.party === 'facility' ? textOrNull(inputs.facilityId) : null,
          note:
            textOrNull(inputs.note) ??
            (inputs.party === 'facility' ? 'Billed to the facility' : 'Billed to the payers')
        });
        return {};
      }
    }),
    actionNode({
      type: 'billing.read-claim-document',
      title: 'Read Claim Document',
      category: CATEGORY,
      description:
        'Reads a document uploaded to a claim: its kind (facesheet, pcs, signature, abn or msp), the date it was signed and its file name.',
      level: 'basic',
      keywords: ['document', 'attachment', 'pcs', 'abn'],
      inputs: [
        claimIdPin,
        pin(
          'documentId',
          { id: 'document' },
          {
            label: 'Document',
            description: 'The document on the claim to read.'
          }
        )
      ],
      outputs: [
        pin('document', CLAIM_DOCUMENT.type, {
          description: 'The kind, signed date and file name of the document.'
        })
      ],
      compute: async (inputs, _, ctx) => {
        const claimId = claimIdOf(inputs.claimId);
        const documentId = requiredText(inputs.documentId, 'No document to read');
        const document = await claims().claimDocument(ctx.runId, claimId, documentId);
        if (!document) throw new Error(`Document ${documentId} is not on claim ${claimId}`);
        return { document };
      }
    }),
    actionNode({
      type: 'billing.note-revision',
      title: 'Note PCR Revision',
      category: CATEGORY,
      description:
        'Logs on a claim that an updated version of its patient care report arrived, with the new report attached. Once per step.',
      level: 'basic',
      keywords: ['revision', 'updated report', 'amended pcr'],
      effect: true,
      inputs: [
        claimIdPin,
        pin('report', BLOB, { description: 'The updated patient care report.' })
      ],
      outputs: [
        pin('status', 'string', {
          description: 'The status of the claim when the update arrived.'
        }),
        pin('previous', BLOB, {
          label: 'Previous Report',
          description: 'The report the claim was billed from before.'
        })
      ],
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
        return { status, previous };
      }
    })
  ];
};
