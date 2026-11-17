import type { GraphDef, Json } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import { asRule, asStage, breakRecord, d, exit, listOf, PERSON, rule, stage, T } from './shared.ts';

const PATIENT_ID = { id: 'patient' } as const;

const CANDIDATE = {
  object: { patientId: PATIENT_ID, name: 'string', birthDate: 'string' }
} as const;

const CHOICE = { object: { value: 'string', label: 'string' } } as const;

const patientChoice = (): GraphDef => {
  const g = rule(
    [d('candidate', CANDIDATE, 'Candidate', 'A patient like the one reported.')],
    [d('choice', CHOICE, 'Choice', 'The patient as a choice in a form: the ID and a label.')]
  );
  g.add('parts', 'std.object.break', {
    label: 'Candidate',
    config: {
      fields: [
        { name: 'patientId', type: PATIENT_ID },
        { name: 'name', type: 'string' },
        { name: 'birthDate', type: 'string' }
      ]
    } as Json
  });
  g.add('label', 'std.text.template', {
    label: 'Name and Birth Date',
    config: { template: '{name}, born {birthDate}' }
  });
  g.add('choice', 'std.object.make', {
    label: 'Choice',
    config: {
      fields: [
        { name: 'value', type: 'string' },
        { name: 'label', type: 'string' }
      ]
    } as Json
  });
  g.wire('entry.candidate', 'parts.object');
  g.wire('parts.name', 'label.name');
  g.wire('parts.birthDate', 'label.birthDate');
  g.wire('parts.patientId', 'choice.value');
  g.wire('label.text', 'choice.label');
  g.ret('return');
  g.wire('choice.object', 'return.choice');
  return g.def;
};

const QUEUE = 'billing';

const resolvePatient = (): GraphDef => {
  const g = stage(
    [d('person', T.person, 'Person', 'The patient as the report names them.')],
    [d('patientId', PATIENT_ID, 'Patient', 'The patient the encounter is for.')],
    { resolved: exit('Resolved', 'The patient is known, found or added.') }
  );
  breakRecord(g, 'person', 'Person', PERSON, 'entry.person');
  g.add('subject', 'std.text.template', {
    label: 'Patient Name',
    config: { template: '{lastName}, {firstName}' }
  });
  g.wire('person.lastName', 'subject.lastName');
  g.wire('person.firstName', 'subject.firstName');
  g.add('find', 'patient.find', { label: 'Find the Patient' });
  g.add('add', 'patient.save', { label: 'Add a New Patient' });
  g.add('choices', 'std.list.map-rule', {
    label: 'Choices of Similar Patients',
    config: { rule: 'billing.patient-choice', version: 1, item: 'candidate' }
  });
  g.add('options', 'std.object.make', {
    label: 'Patient Choices',
    config: { fields: [{ name: 'patientId', type: listOf(CHOICE) }] } as Json
  });
  g.add('choose', 'std.human.task', {
    label: 'Choose the Patient',
    config: {
      title: 'Choose the Patient',
      queue: QUEUE,
      instructions:
        'The reported patient is like patients already on file. Choose the same person, or add them as a new patient.',
      fields: [{ name: 'patientId', type: PATIENT_ID, label: 'Patient', required: ['same'] }],
      outcomes: ['same', 'new'],
      hints: { same: 'Use the patient chosen.', new: 'Add the reported person as a new patient.' }
    } as Json
  });
  g.add('defaults', 'std.object.make', {
    label: 'Details Reported',
    config: {
      fields: [
        { name: 'firstName', type: 'string' },
        { name: 'lastName', type: 'string' },
        { name: 'birthDate', type: 'string' }
      ]
    } as Json
  });
  g.add('complete', 'std.human.task', {
    label: 'Complete the Patient',
    config: {
      title: 'Complete the Patient',
      queue: QUEUE,
      instructions:
        'The report does not name the patient well enough to find or add them. Fill in their name and birth date from the facesheet.',
      fields: [
        { name: 'firstName', type: 'string', label: 'First Name', required: ['save'] },
        { name: 'lastName', type: 'string', label: 'Last Name', required: ['save'] },
        {
          name: 'birthDate',
          type: 'string',
          label: 'Birth Date',
          format: 'date',
          required: ['save']
        }
      ],
      outcomes: ['save'],
      hints: { save: 'Find or add the patient with these details.' }
    } as Json
  });
  g.add('completed', 'person.make', { label: 'Person Completed' });
  g.add('findCompleted', 'patient.find', { label: 'Find the Completed Patient' });
  g.add('addCompleted', 'patient.save', { label: 'Add the Completed Patient' });
  for (const id of ['matched', 'added', 'chosen', 'matchedCompleted', 'addedCompleted']) {
    g.ret(id, 'resolved');
  }
  g.wire('entry.exec', 'find.exec');
  g.wire('entry.person', 'find.person', 'add.person');
  g.wire('find.matched', 'matched.exec');
  g.wire('find.patientId', 'matched.patientId');
  g.wire('find.notFound', 'add.exec');
  g.wire('add.then', 'added.exec');
  g.wire('add.patientId', 'added.patientId');
  g.wire('find.similar', 'choose.exec');
  g.wire('find.candidates', 'choices.list');
  g.wire('choices.choice', 'options.patientId');
  g.wire('options.object', 'choose.options');
  g.wire('subject.text', 'choose.subject', 'complete.subject');
  g.wire('choose.same', 'chosen.exec');
  g.wire('choose.patientId', 'chosen.patientId');
  g.wire('choose.new', 'add.exec');
  g.wire('find.incomplete', 'complete.exec');
  g.wire('person.firstName', 'defaults.firstName');
  g.wire('person.lastName', 'defaults.lastName');
  g.wire('person.birthDate', 'defaults.birthDate');
  g.wire('defaults.object', 'complete.defaults');
  for (const field of PERSON.fields.map((f) => f.name)) {
    const from = ['firstName', 'lastName', 'birthDate'].includes(field) ? 'complete' : 'person';
    g.wire(`${from}.${field}`, `completed.${field}`);
  }
  g.wire('complete.save', 'findCompleted.exec');
  g.wire('completed.person', 'findCompleted.person', 'addCompleted.person');
  g.wire('findCompleted.matched', 'matchedCompleted.exec');
  g.wire('findCompleted.patientId', 'matchedCompleted.patientId');
  for (const exit of ['notFound', 'similar', 'incomplete']) {
    g.wire(`findCompleted.${exit}`, 'addCompleted.exec');
  }
  g.wire('addCompleted.then', 'addedCompleted.exec');
  g.wire('addCompleted.patientId', 'addedCompleted.patientId');
  return g.def;
};

export const patientGraphs: SeedGraph[] = [
  asRule(
    'billing.patient-choice',
    'Patient Choice',
    'One patient like the reported one, as a choice in a form: the patient ID, labelled with their name and birth date.',
    patientChoice()
  ),
  asStage(
    'billing.resolve-patient',
    'Resolve Patient',
    'Finds the patient an encounter is for, or adds them. When patients on file are only similar, a biller chooses; when the report does not name the patient well enough, a biller completes their details.',
    resolvePatient()
  )
];
