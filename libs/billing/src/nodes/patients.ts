import { actionNode, branchNode, pin } from '@ugula/graph';
import { DEMOGRAPHICS, PATIENT } from '../models.ts';
import { nameKey } from '../names.ts';
import { matchPatient, readDemographics, toNewPatient } from '../patients.ts';
import { requiredText } from '../values.ts';
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
        'Finds the existing patient with the same last name, birth date and first name or nickname, or flags likely matches (similar names, birth date typos) for review. Also outputs the cleaned demographics.',
      inputs: [demographicsPin],
      outputs: [
        patientPin,
        pin('candidates', { list: PATIENT.type }),
        pin('reason', 'string'),
        demographicsPin
      ],
      exits: ['matched', 'unmatched', 'review'],
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
    actionNode({
      type: 'billing.create-patient',
      title: 'Create Patient',
      category: CATEGORY,
      description:
        'Creates a patient from report demographics, once per run step. With reuseMatch, returns the patient another run created for the same person instead.',
      effect: true,
      inputs: [demographicsPin, pin('reuseMatch', 'boolean', { optional: true })],
      outputs: [patientPin],
      compute: async (inputs, _, ctx) => {
        const patient = toNewPatient(readDemographics(inputs.demographics));
        if (!patient) {
          throw new Error('A patient needs a first name, last name and valid birth date');
        }
        return {
          patient: await patients().createPatient(
            ctx.runId,
            ctx.key,
            patient,
            inputs.reuseMatch === true
          )
        };
      }
    }),
    actionNode({
      type: 'billing.find-patient',
      title: 'Find Patient',
      category: CATEGORY,
      description: 'Loads an existing patient by id, such as the one a biller picked in a task.',
      inputs: [pin('patientId', 'string')],
      outputs: [patientPin],
      compute: async (inputs, _, ctx) => {
        const id = requiredText(inputs.patientId, 'Choose a patient');
        const patient = await patients().findPatient(ctx.runId, id);
        if (!patient) throw new Error(`Patient ${id} does not exist`);
        return { patient };
      }
    })
  ];
};
