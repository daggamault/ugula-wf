import { actionNode, branchNode, pin } from '@ugula/graph';
import { nameKey } from '../names.ts';
import { DEMOGRAPHICS, PATIENT } from '../party-models.ts';
import {
  isCompleteAddress,
  matchPatient,
  readDemographics,
  sameAddress,
  toNewPatient
} from '../patients.ts';
import { recordOf, requiredText, textOrNull } from '../values.ts';
import type { NodesOf } from './stores.ts';

const CATEGORY = 'Billing';

const demographicsPin = pin('demographics', DEMOGRAPHICS.type, {
  description: 'The name, birth date, sex and address of the patient as reported.'
});

const patientPin = pin('patient', PATIENT.type, { description: 'The billing patient.' });

export const patientNodes: NodesOf = (stores) => {
  const patients = () => stores().patients;
  return [
    branchNode({
      type: 'billing.match-patient',
      title: 'Match Patient',
      category: CATEGORY,
      description:
        'Finds the existing patient with the same last name, birth date and first name or nickname, or flags likely matches (similar names, birth date typos) for review. Also gives the cleaned demographics.',
      level: 'basic',
      keywords: ['patient', 'duplicate', 'find', 'search'],
      inputs: [demographicsPin],
      outputs: [
        pin('patient', PATIENT.type, { description: 'The existing patient that matched.' }),
        pin(
          'candidates',
          { list: PATIENT.type },
          {
            description: 'Existing patients that may be this person.'
          }
        ),
        pin('reason', 'string', { description: 'Why the likely matches need a review.' }),
        pin('demographics', DEMOGRAPHICS.type, {
          description: 'The reported demographics, cleaned up.'
        })
      ],
      exits: {
        matched: { label: 'Matched', description: 'One existing patient is this person.' },
        unmatched: { label: 'Unmatched', description: 'No existing patient is this person.' },
        review: {
          label: 'Review',
          description: 'Some existing patients may be this person; a biller decides.'
        },
        incomplete: {
          label: 'Incomplete',
          description: 'The report lacks a first name, last name or valid birth date.'
        }
      },
      compute: async (inputs, _, ctx) => {
        const d = readDemographics(inputs.demographics);
        const candidates = await patients().findCandidates(ctx.runId, {
          birthDate: d.birthDate,
          lastNameKey: d.lastName ? nameKey(d.lastName) || null : null,
          firstName: d.firstName
        });
        const decision = matchPatient(d, candidates);
        return {
          exit: decision.kind,
          outputs: {
            patient: decision.kind === 'matched' ? decision.patient : null,
            candidates: decision.kind === 'review' ? decision.candidates : [],
            reason: decision.kind === 'review' ? decision.reason : '',
            demographics: d
          }
        };
      }
    }),
    branchNode({
      type: 'billing.create-patient',
      title: 'Create Patient',
      category: CATEGORY,
      description:
        'Creates a patient from report demographics, once per step. When asked, gives the patient another run created for the same person instead.',
      level: 'basic',
      keywords: ['new patient', 'add patient'],
      effect: true,
      inputs: [
        demographicsPin,
        pin('reuseMatch', 'boolean', {
          optional: true,
          label: 'Reuse Match',
          description: 'Use the patient another run already created for the same person.'
        })
      ],
      outputs: [pin('patient', PATIENT.type, { description: 'The patient created.' })],
      exits: {
        created: { label: 'Created', description: 'The patient was created.' },
        invalid: {
          label: 'Invalid',
          description: 'The first name, last name or birth date is missing or not a real date.'
        }
      },
      compute: async (inputs, _, ctx) => {
        const patient = toNewPatient(readDemographics(inputs.demographics));
        if (!patient) return { exit: 'invalid', outputs: { patient: null } };
        return {
          exit: 'created',
          outputs: {
            patient: await patients().createPatient(
              ctx.runId,
              ctx.key,
              patient,
              inputs.reuseMatch === true
            )
          }
        };
      }
    }),
    branchNode({
      type: 'billing.find-patient',
      title: 'Find Patient',
      category: CATEGORY,
      description: 'Loads an existing patient, such as the one a biller picked in a task.',
      level: 'basic',
      keywords: ['patient', 'lookup'],
      inputs: [
        pin(
          'patientId',
          { id: 'patient' },
          {
            optional: true,
            label: 'Patient',
            description: 'The patient to load.'
          }
        )
      ],
      outputs: [pin('patient', PATIENT.type, { description: 'The patient found.' })],
      exits: {
        found: { label: 'Found', description: 'The patient was found.' },
        missing: {
          label: 'Missing',
          description: 'No patient was picked or it no longer exists.'
        }
      },
      compute: async (inputs, _, ctx) => {
        const id = textOrNull(inputs.patientId);
        const patient = id ? await patients().findPatient(ctx.runId, id) : null;
        return { exit: patient ? 'found' : 'missing', outputs: { patient } };
      }
    }),
    actionNode({
      type: 'billing.update-patient-address',
      title: 'Update Patient Address',
      category: CATEGORY,
      description:
        'Moves an existing patient to the address on a newer report when the report has a complete address that differs, once per step, so statements go where the patient lives now. Gives the patient as it is afterwards.',
      level: 'basic',
      keywords: ['address', 'move', 'patient'],
      effect: true,
      inputs: [patientPin, demographicsPin],
      outputs: [
        pin('patient', PATIENT.type, { description: 'The patient with the current address.' })
      ],
      compute: async (inputs, _, ctx) => {
        const current = recordOf(inputs.patient);
        const id = requiredText(current.id, 'The patient has no id');
        const reported = readDemographics(inputs.demographics);
        const known = readDemographics(current);
        if (!isCompleteAddress(reported) || sameAddress(reported, known)) {
          return { patient: inputs.patient };
        }
        return {
          patient: await patients().updateAddress(ctx.runId, ctx.key, id, {
            addressLine: reported.addressLine,
            city: reported.city,
            state: reported.state,
            postalCode: reported.postalCode
          })
        };
      }
    })
  ];
};
