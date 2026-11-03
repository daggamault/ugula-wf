import { actionNode, branchNode, pin } from '@ugula/graph';
import { DEMOGRAPHICS, PATIENT } from '../models.ts';
import { nameKey } from '../names.ts';
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

const demographicsPin = pin('demographics', DEMOGRAPHICS.type);

const patientPin = pin('patient', PATIENT.type);

export const patientNodes: NodesOf = (stores) => {
  const patients = () => stores().patients;
  return [
    branchNode({
      type: 'billing.match-patient',
      title: 'Match Patient',
      category: CATEGORY,
      description:
        'Finds the existing patient with the same last name, birth date and first name or nickname, or flags likely matches (similar names, birth date typos) for review. Continues through incomplete when the report lacks a first name, last name or valid birth date. Also outputs the cleaned demographics.',
      inputs: [demographicsPin],
      outputs: [
        patientPin,
        pin('candidates', { list: PATIENT.type }),
        pin('reason', 'string'),
        demographicsPin
      ],
      exits: ['matched', 'unmatched', 'review', 'incomplete'],
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
        'Creates a patient from report demographics, once per run step. With reuseMatch, returns the patient another run created for the same person instead. Continues through invalid when the first name, last name or birth date is missing or not a real date.',
      effect: true,
      inputs: [demographicsPin, pin('reuseMatch', 'boolean', { optional: true })],
      outputs: [patientPin],
      exits: ['created', 'invalid'],
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
      description:
        'Loads an existing patient by id, such as the one a biller picked in a task. Continues through missing when none was picked or it no longer exists.',
      inputs: [pin('patientId', 'string', { optional: true })],
      outputs: [patientPin],
      exits: ['found', 'missing'],
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
        'Moves an existing patient to the address on a newer report when the report has a complete address that differs, once per run step, so statements go where the patient lives now. Outputs the patient as it is afterwards.',
      effect: true,
      inputs: [patientPin, demographicsPin],
      outputs: [patientPin],
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
