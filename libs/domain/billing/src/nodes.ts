import { actionNode, branchNode, type NodeDef, pin } from '@ugula/graph';
import { type ClaimValue, readClaim, readClaimReview } from './claims.ts';
import { normalizeCode } from './code-sets.ts';
import { CLAIM_TYPE, PATIENT_TYPE, PAYER_TYPE } from './models.ts';
import { nameKey } from './names.ts';
import {
  type Demographics,
  matchPatient,
  type Patient,
  readDemographics,
  toNewPatient
} from './patients.ts';
import type { BillingStores } from './stores.ts';
import { recordOf } from './values.ts';

const ADDRESS = {
  object: { line: 'string', city: 'string', state: 'string', postalCode: 'string' }
} as const;

const PATIENT_DETAILS = {
  object: {
    firstName: 'string',
    lastName: 'string',
    birthDate: 'string',
    sex: 'string',
    gender: 'string',
    address: ADDRESS
  }
} as const;

const PATIENT_ID = { id: 'patient' } as const;

const PAYER_ID = { id: 'payer' } as const;

const CLAIM_ID = { id: 'claim' } as const;

const ICD10 = { code: 'icd10' } as const;

const DIAGNOSIS_MATCH = {
  object: { code: ICD10, description: 'string', score: 'number' }
} as const;

const icd10Of = (code: string) => normalizeCode('icd10cm', code);

const uniqueCodes = (codes: readonly (string | null)[]) => [
  ...new Set(codes.filter((c): c is string => typeof c === 'string' && c.trim() !== ''))
];

const PERSON_PIN = pin('person', PATIENT_DETAILS, {
  description: 'Who the patient is: name, birth date, sex and address. A Person connects here.'
});

const demographicsOf = (person: unknown): Demographics => {
  const p = recordOf(person);
  const a = recordOf(p.address);
  return readDemographics({
    firstName: p.firstName,
    lastName: p.lastName,
    birthDate: p.birthDate,
    gender: p.sex ?? p.gender,
    addressLine: a.line,
    city: a.city,
    state: a.state,
    postalCode: a.postalCode
  });
};

const readExits = (noun: string) => ({
  found: { label: 'Found', description: `The ${noun} exists; its fields are on the outputs.` },
  notFound: {
    label: 'Not Found',
    description: `No ${noun} has this ID in the agency, so the outputs are empty.`
  }
});

const patientRecord = (p: Patient) => ({
  id: p.id,
  firstName: p.firstName,
  lastName: p.lastName,
  birthDate: p.birthDate,
  sex: p.gender,
  address: { line: p.addressLine, city: p.city, state: p.state, postalCode: p.postalCode }
});

const CANDIDATE = {
  object: { patientId: PATIENT_ID, name: 'string', birthDate: 'string' }
} as const;

const PAYER_CANDIDATE = {
  object: { payerId: PAYER_ID, payerName: 'string', similarity: 'number' }
} as const;

export const createBillingNodes = (stores: BillingStores | null): NodeDef[] => {
  const storesOf = () => {
    if (!stores) throw new Error('Billing nodes need storage, which only the worker provides');
    return stores;
  };
  return [
    branchNode({
      type: 'patient.find',
      title: 'Find Patient',
      category: 'Patient',
      description:
        "Looks for the patient among the agency's patients by name and birth date, allowing for nicknames and typos.",
      level: 'basic',
      keywords: ['match', 'patient', 'search', 'duplicate'],
      inputs: [PERSON_PIN],
      outputs: [
        pin('patientId', PATIENT_ID, { label: 'Patient', description: 'The patient matched.' }),
        pin(
          'candidates',
          { list: CANDIDATE },
          { description: 'Patients like this one, closest first, when none is a sure match.' }
        )
      ],
      exits: {
        matched: { label: 'Matched', description: 'Exactly one patient is this person.' },
        similar: {
          label: 'Similar',
          description: 'Patients like this one need a person to choose.'
        },
        notFound: { label: 'Not Found', description: 'No patient is like this one.' },
        incomplete: {
          label: 'Incomplete',
          description: 'There is no last name or birth date to look by.'
        }
      },
      compute: async ({ person }, _, ctx) => {
        const d = demographicsOf(person);
        const lastNameKey = d.lastName ? nameKey(d.lastName) : null;
        if (!lastNameKey && !d.birthDate) return { exit: 'incomplete', outputs: {} };
        const found = await storesOf().patients.findCandidates(ctx.runId, {
          birthDate: d.birthDate,
          lastNameKey,
          firstName: d.firstName
        });
        const decision = matchPatient(d, found);
        switch (decision.kind) {
          case 'matched':
            return { exit: 'matched', outputs: { patientId: decision.patient.id } };
          case 'review':
            return {
              exit: 'similar',
              outputs: {
                candidates: decision.candidates.map((c) => ({
                  patientId: c.id,
                  name: `${c.lastName}, ${c.firstName}`,
                  birthDate: c.birthDate
                }))
              }
            };
          case 'incomplete':
            return { exit: 'incomplete', outputs: {} };
          case 'unmatched':
            return { exit: 'notFound', outputs: {} };
        }
      }
    }),
    actionNode({
      type: 'patient.save',
      title: 'Save Patient',
      category: 'Patient',
      description:
        'Adds the person as a new patient, or, given a patient, updates their address when the person has a complete one.',
      level: 'basic',
      keywords: ['create', 'patient', 'new', 'address', 'update'],
      effect: true,
      inputs: [
        PERSON_PIN,
        pin('patientId', PATIENT_ID, {
          optional: true,
          label: 'Patient',
          description: 'The patient to update; a new patient when empty.'
        })
      ],
      outputs: [
        pin('patientId', PATIENT_ID, { label: 'Patient', description: 'The patient saved.' })
      ],
      compute: async ({ person, patientId }, _, ctx) => {
        const d = demographicsOf(person);
        const { patients } = storesOf();
        if (patientId) {
          const complete = d.addressLine && d.city && d.state && d.postalCode;
          if (complete) await patients.updateAddress(ctx.runId, patientId, d);
          return { patientId };
        }
        const patient = toNewPatient(d);
        if (!patient) throw new Error('A new patient needs a first name, last name and birth date');
        return { patientId: (await patients.createPatient(ctx.runId, ctx.key, patient)).id };
      }
    }),
    branchNode({
      type: 'payer.find',
      title: 'Find Payer',
      category: 'Payer',
      description:
        "Looks for an insurance name in the agency's payer directory, by name and by the names billers linked to a payer before.",
      level: 'basic',
      keywords: ['payer', 'insurance', 'match', 'directory', 'alias'],
      inputs: [pin('name', 'string', { description: 'The insurance name as reported.' })],
      outputs: [
        pin('payerId', PAYER_ID, { label: 'Payer', description: 'The directory payer.' }),
        pin('payerName', 'string', { description: 'The payer name in the directory.' }),
        pin('claimFiling', 'string', {
          description:
            'How the payer is billed, such as MB for Medicare Part B or CI for commercial.'
        }),
        pin(
          'candidates',
          { list: PAYER_CANDIDATE },
          { description: 'Directory payers with a similar name, closest first.' }
        )
      ],
      exits: {
        found: { label: 'Found', description: 'The name or a linked name is in the directory.' },
        similar: { label: 'Similar', description: 'Directory payers have a similar name.' },
        notFound: { label: 'Not Found', description: 'No directory payer is like this name.' }
      },
      compute: async ({ name }, _, ctx) => {
        const { known, similar } = await storesOf().payers.matchPayer(ctx.runId, name);
        if (known) {
          return {
            exit: 'found',
            outputs: { payerId: known.id, payerName: known.name, claimFiling: known.claimFiling }
          };
        }
        return similar.length
          ? {
              exit: 'similar',
              outputs: {
                candidates: similar.map((c) => ({
                  payerId: c.id,
                  payerName: c.name,
                  similarity: c.similarity
                }))
              }
            }
          : { exit: 'notFound', outputs: {} };
      }
    }),
    branchNode({
      type: 'patient.read',
      title: 'Read Patient',
      category: 'Patient',
      description: "Reads one of the agency's patients as it stands now.",
      level: 'basic',
      keywords: ['load', 'patient', 'find', 'demographics', 'address'],
      inputs: [
        pin('patientId', PATIENT_ID, { label: 'Patient', description: 'The patient to read.' })
      ],
      outputs: [pin('patient', PATIENT_TYPE, { description: 'The patient, field by field.' })],
      exits: readExits('patient'),
      compute: async ({ patientId }, _, ctx) => {
        const found = await storesOf().patients.findPatient(ctx.runId, patientId);
        return found
          ? { exit: 'found', outputs: { patient: patientRecord(found) } }
          : { exit: 'notFound', outputs: {} };
      }
    }),
    branchNode({
      type: 'payer.read',
      title: 'Read Payer',
      category: 'Payer',
      description:
        "Reads a payer in the agency's directory: how it is billed and how long it takes claims and appeals.",
      level: 'basic',
      keywords: ['load', 'payer', 'insurance', 'directory', 'filing limit'],
      inputs: [pin('payerId', PAYER_ID, { label: 'Payer', description: 'The payer to read.' })],
      outputs: [pin('payer', PAYER_TYPE, { description: 'The payer, field by field.' })],
      exits: readExits('payer'),
      compute: async ({ payerId }, _, ctx) => {
        const found = await storesOf().payers.findPayer(ctx.runId, payerId);
        return found
          ? { exit: 'found', outputs: { payer: found } }
          : { exit: 'notFound', outputs: {} };
      }
    }),
    branchNode({
      type: 'fee.find',
      title: 'Find Fee',
      category: 'Claim',
      description:
        "Finds the agency's price for one unit of a HCPCS code: the payer's own fee when it has one, otherwise the agency's standard fee.",
      level: 'basic',
      keywords: ['price', 'fee', 'charge', 'rate', 'hcpcs'],
      inputs: [
        pin('code', { code: 'hcpcs' }, { description: 'The HCPCS code to price.' }),
        pin('payerId', PAYER_ID, {
          optional: true,
          label: 'Payer',
          description: 'The payer billed; the standard fee only when empty.'
        })
      ],
      outputs: [pin('unitCents', 'integer', { description: 'The price of one unit, in cents.' })],
      exits: {
        found: { label: 'Found', description: 'The code has a fee.' },
        notFound: { label: 'Not Found', description: 'The agency has no fee for the code.' }
      },
      compute: async ({ code, payerId }, _, ctx) => {
        const unitCents = await storesOf().fees.findFee(ctx.runId, payerId, code);
        return unitCents === null
          ? { exit: 'notFound', outputs: {} }
          : { exit: 'found', outputs: { unitCents } };
      }
    }),
    branchNode({
      type: 'claim.save',
      title: 'Save Claim',
      category: 'Claim',
      description:
        'Saves the claim for its encounter as Needs Review, for a biller to review. A claim already saved for the encounter is replaced, gets a new revision and needs review again, even when it was approved; a claim already sent to the clearinghouse is kept as it was sent. A new claim emits Claim Created.',
      level: 'basic',
      keywords: ['store', 'claim', 'create', 'review'],
      effect: true,
      inputs: [pin('claim', CLAIM_TYPE, { description: 'The claim to save.' })],
      outputs: [
        pin('claimId', CLAIM_ID, { label: 'Claim', description: 'The claim saved.' }),
        pin('revision', 'integer', {
          description:
            'Which version of the claim this is, 1 for the first; a review is for one revision.'
        })
      ],
      exits: {
        created: { label: 'Created', description: 'The encounter had no claim yet.' },
        replaced: { label: 'Replaced', description: 'The claim already saved was replaced.' },
        alreadySent: {
          label: 'Already Sent',
          description:
            'The claim was already sent to the clearinghouse, so it was kept as sent; a change now needs a corrected claim.'
        }
      },
      compute: async ({ claim }, _, ctx) => {
        const saved = await storesOf().claims.saveClaim(ctx.runId, readClaim(claim as ClaimValue));
        return { exit: saved.outcome, outputs: { claimId: saved.id, revision: saved.revision } };
      }
    }),
    branchNode({
      type: 'claim.read',
      title: 'Read Claim',
      category: 'Claim',
      description:
        'Reads a saved claim as it stands now: its latest revision, with its payers, charge lines and diagnoses.',
      level: 'basic',
      keywords: ['load', 'claim', 'find', 'revision'],
      inputs: [pin('claimId', CLAIM_ID, { label: 'Claim', description: 'The claim to read.' })],
      outputs: [pin('claim', CLAIM_TYPE, { description: 'The claim, field by field.' })],
      exits: readExits('claim'),
      compute: async ({ claimId }, _, ctx) => {
        const found = await storesOf().claims.findClaim(ctx.runId, claimId);
        return found
          ? { exit: 'found', outputs: { claim: found } }
          : { exit: 'notFound', outputs: {} };
      }
    }),
    branchNode({
      type: 'claim.check',
      title: 'Check Claim',
      category: 'Claim',
      description:
        'Checks a saved claim has everything the 837P needs to send it to the clearinghouse: the billing profile, date of service, diagnoses, priced lines, a first payer in the payer directory with its member ID, and the patient, pickup and destination addresses. A claim the patient pays needs only the patient address.',
      level: 'basic',
      keywords: ['claim', 'ready', 'validate', '837', 'clearinghouse', 'missing'],
      inputs: [pin('claimId', CLAIM_ID, { label: 'Claim', description: 'The claim to check.' })],
      outputs: [
        pin(
          'issues',
          { list: 'string' },
          { description: 'What the claim lacks to be sent, empty when it is ready.' }
        )
      ],
      exits: {
        ready: { label: 'Ready', description: 'The claim can be sent as it is.' },
        notReady: {
          label: 'Not Ready',
          description: 'The claim lacks something the 837P needs; the issues say what.'
        }
      },
      compute: async ({ claimId }, _, ctx) => {
        const issues = await storesOf().claims.checkClaim(ctx.runId, claimId);
        if (issues === null) throw new Error(`Claim ${claimId} was not found`);
        return { exit: issues.length ? 'notReady' : 'ready', outputs: { issues } };
      }
    }),
    branchNode({
      type: 'claim.send',
      title: 'Send Claim',
      category: 'Claim',
      description:
        "Sends a claim to the agency's clearinghouse as an 837P file, billed to its current payer: the first payer not done with it, with what each payer before it paid. It marks that payer and the claim Sent. A claim is sent once approved, again after a rejection, and to the next payer once the one before has paid; a claim the patient pays has no payer to send to.",
      level: 'basic',
      keywords: ['claim', 'send', 'submit', '837', 'clearinghouse', 'sftp'],
      effect: true,
      inputs: [pin('claimId', CLAIM_ID, { label: 'Claim', description: 'The claim to send.' })],
      outputs: [
        pin('fileName', 'string', {
          optional: true,
          label: 'File Name',
          description: 'The 837P file uploaded, when sent.'
        }),
        pin('controlNumber', 'integer', {
          optional: true,
          label: 'Control Number',
          description: 'The interchange control number of the file, when sent.'
        }),
        pin(
          'issues',
          { list: 'string' },
          { description: 'What the claim lacks to be sent, when it is not ready.' }
        )
      ],
      exits: {
        sent: { label: 'Sent', description: 'The 837P is with the clearinghouse.' },
        selfPay: {
          label: 'Self Pay',
          description: 'The claim has no payer, so the patient is billed and nothing is sent.'
        },
        notReady: {
          label: 'Not Ready',
          description: 'The claim lacks something the 837P needs; the issues say what.'
        },
        nothingToSend: {
          label: 'Nothing to Send',
          description:
            'The claim is not approved, its current payer already has it, or every payer is done with it.'
        }
      },
      compute: async ({ claimId }, _, ctx) => {
        const sent = await storesOf().claims.sendClaim(ctx.runId, claimId);
        switch (sent.outcome) {
          case 'sent':
            return {
              exit: 'sent',
              outputs: { fileName: sent.fileName, controlNumber: sent.controlNumber, issues: [] }
            };
          case 'notReady':
            return { exit: 'notReady', outputs: { issues: sent.issues } };
          default:
            return { exit: sent.outcome, outputs: { issues: [] } };
        }
      }
    }),
    branchNode({
      type: 'claim.review',
      title: 'Record Claim Review',
      category: 'Claim',
      description:
        'Records the decision of the biller who reviewed a claim: Approved, ready for the clearinghouse, or On Hold with a note. Only the revision the biller saw is decided; a claim revised since then needs a review of its own, and a claim that lacks something the 837P needs is not approved.',
      level: 'basic',
      keywords: ['claim', 'review', 'approve', 'hold', 'biller', 'clearinghouse'],
      effect: true,
      inputs: [
        pin('claimId', CLAIM_ID, { label: 'Claim', description: 'The claim reviewed.' }),
        pin('revision', 'integer', {
          description: 'The revision of the claim the biller reviewed.'
        }),
        pin(
          'decision',
          { code: 'claimDecision' },
          { description: 'Approved for the clearinghouse, or On Hold.' }
        ),
        pin('reviewedBy', 'string', {
          label: 'Reviewed By',
          description: 'The biller who reviewed the claim.'
        }),
        pin('note', 'string', {
          optional: true,
          description: 'Why the claim is on hold, or anything the biller noted.'
        })
      ],
      outputs: [],
      exits: {
        recorded: { label: 'Recorded', description: 'The decision is on the claim.' },
        superseded: {
          label: 'Superseded',
          description:
            'The claim was revised after the review began; its new revision has its own review.'
        },
        notReady: {
          label: 'Not Ready',
          description:
            'The claim lacks something the 837P needs, so it was not approved; Check Claim says what.'
        }
      },
      compute: async (inputs, _, ctx) => ({
        exit: await storesOf().claims.reviewClaim(
          ctx.runId,
          readClaimReview({
            claimId: inputs.claimId ?? null,
            revision: inputs.revision ?? null,
            decision: inputs.decision ?? null,
            reviewedBy: inputs.reviewedBy ?? null,
            note: inputs.note ?? null
          })
        ),
        outputs: {}
      })
    }),
    actionNode({
      type: 'diagnosis.check',
      title: 'Check Diagnoses',
      category: 'Claim',
      description:
        'Checks reported diagnosis codes against ICD-10-CM, written the way a claim needs them (no dot), and splits the billable ones from codes that are unknown or not specific enough to bill.',
      level: 'basic',
      keywords: ['icd', 'icd-10', 'diagnosis', 'valid', 'billable', 'specific'],
      inputs: [
        pin('codes', { list: ICD10 }, { optional: true, description: 'The codes to check.' })
      ],
      outputs: [
        pin(
          'billable',
          { list: ICD10 },
          { description: 'The billable codes, each once, in the order given.' }
        ),
        pin(
          'rejected',
          { list: ICD10 },
          {
            description:
              'The codes as given that are not billable ICD-10-CM codes, such as a category without its last characters.'
          }
        )
      ],
      compute: async ({ codes }) => {
        const given = uniqueCodes(codes ?? []);
        const known = new Set(
          given.length
            ? (await storesOf().diagnoses.findBillable(given.map(icd10Of))).map((d) => d.code)
            : []
        );
        return {
          billable: [...new Set(given.map(icd10Of).filter((c) => known.has(c)))],
          rejected: given.filter((c) => !known.has(icd10Of(c)))
        };
      }
    }),
    actionNode({
      type: 'diagnosis.search',
      title: 'Search Diagnoses',
      category: 'Claim',
      description:
        'Finds the billable ICD-10-CM codes whose descriptions mean the closest to a free text, such as a complaint, an impression or a narrative, best first. It searches the codes NEMSIS lists for EMS impressions and symptoms unless asked to search them all, as an injury needs. The score runs from 0 to 1 and only ranks; a person should confirm a code found this way.',
      level: 'basic',
      keywords: ['icd', 'icd-10', 'diagnosis', 'search', 'narrative', 'meaning', 'embedding'],
      inputs: [
        pin('text', 'string', { optional: true, description: 'What to find a diagnosis for.' }),
        pin('limit', 'integer', { default: 5, description: 'How many matches to give at most.' }),
        pin('emsOnly', 'boolean', {
          default: true,
          label: 'EMS Codes Only',
          description:
            'Whether to search only the impressions and symptoms NEMSIS lists, rather than every billable code.'
        })
      ],
      outputs: [
        pin(
          'matches',
          { list: DIAGNOSIS_MATCH },
          { description: 'The closest codes with their descriptions and scores, best first.' }
        ),
        pin('best', ICD10, {
          optional: true,
          label: 'Best Code',
          description: 'The closest code, or nothing when the text is empty.'
        }),
        pin('bestScore', 'number', {
          optional: true,
          label: 'Best Score',
          description: 'How close the best code is, from 0 to 1.'
        })
      ],
      compute: async ({ text, limit, emsOnly }) => {
        const query = text?.trim() ?? '';
        const matches = query
          ? await storesOf().diagnoses.search(
              query,
              Math.min(Math.max(limit as number, 1), 50),
              emsOnly === true
            )
          : [];
        const [first] = matches;
        return { matches, best: first?.code ?? null, bestScore: first?.score ?? null };
      }
    })
  ];
};
