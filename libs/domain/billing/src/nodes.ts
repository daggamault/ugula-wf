import { actionNode, branchNode, type NodeDef, pin } from '@ugula/graph';
import { type ClaimValue, readClaim, readClaimReview } from './claims.ts';
import { CLAIM_TYPE } from './models.ts';
import { nameKey } from './names.ts';
import { type Demographics, matchPatient, readDemographics, toNewPatient } from './patients.ts';
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
        const { known, similar } = await storesOf().payers.findPayer(ctx.runId, name);
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
        'Saves the claim for its encounter as Needs Review, for a biller to review. A claim already saved for the encounter is replaced, gets a new revision and needs review again, even when it was approved. A new claim emits Claim Created.',
      level: 'basic',
      keywords: ['store', 'claim', 'create', 'review'],
      effect: true,
      inputs: [pin('claim', CLAIM_TYPE, { description: 'The claim to save.' })],
      outputs: [
        pin('claimId', { id: 'claim' }, { label: 'Claim', description: 'The claim saved.' }),
        pin('revision', 'integer', {
          description:
            'Which version of the claim this is, 1 for the first; a review is for one revision.'
        })
      ],
      exits: {
        created: { label: 'Created', description: 'The encounter had no claim yet.' },
        replaced: { label: 'Replaced', description: 'The claim already saved was replaced.' }
      },
      compute: async ({ claim }, _, ctx) => {
        const saved = await storesOf().claims.saveClaim(ctx.runId, readClaim(claim as ClaimValue));
        return { exit: saved.outcome, outputs: { claimId: saved.id, revision: saved.revision } };
      }
    }),
    branchNode({
      type: 'claim.review',
      title: 'Record Claim Review',
      category: 'Claim',
      description:
        'Records the decision of the biller who reviewed a claim: Approved, ready for the clearinghouse, or On Hold with a note. Only the revision the biller saw is decided; a claim revised since then needs a review of its own.',
      level: 'basic',
      keywords: ['claim', 'review', 'approve', 'hold', 'biller', 'clearinghouse'],
      effect: true,
      inputs: [
        pin('claimId', { id: 'claim' }, { label: 'Claim', description: 'The claim reviewed.' }),
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
    })
  ];
};
