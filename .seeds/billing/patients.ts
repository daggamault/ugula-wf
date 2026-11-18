import type { GraphDef, Json } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  asRule,
  asStage,
  type Builder,
  breakRecord,
  choiceRule,
  choicesFor,
  d,
  exit,
  ID,
  n,
  PERSON,
  QUEUE,
  stage,
  T,
  template
} from './shared.ts';

const PERSON_IN = d('person', T.person, 'Person', 'The patient as the report names them.');

const PATIENT_OUT = d('patientId', ID.patient, 'Patient', 'The patient the encounter is for.');

const IDENTITY = ['firstName', 'lastName', 'birthDate'];

const subjectOf = (g: Builder) =>
  template(
    g,
    'subject',
    n('Patient Name', 'Names the task by the patient.'),
    '{lastName}, {firstName}',
    {
      lastName: 'person.lastName',
      firstName: 'person.firstName'
    }
  );

const matchPatient = (): GraphDef => {
  const g = stage([PERSON_IN], [{ ...PATIENT_OUT, optional: true }], {
    matched: exit('Matched', 'The patient is known, found or added.'),
    incomplete: exit('Incomplete', 'The person has no last name or birth date to look by.')
  });
  breakRecord(
    g,
    'person',
    n('Person', 'The name, birth date and address to match by.'),
    PERSON,
    'entry.person'
  );
  g.add('find', 'patient.find', {
    label: 'Find Patient',
    note: 'Looks for this patient among the agency’s patients.'
  });
  g.add('add', 'patient.save', {
    label: 'Add a New Patient',
    note: 'Adds the patient when nobody matches.'
  });
  const options = choicesFor(
    g,
    'options',
    n('Similar Patients', 'The similar patients a biller chooses from.'),
    'billing.patient-choice',
    'patientId',
    'find.candidates'
  );
  g.add('choose', 'std.human.task', {
    label: 'Choose the Patient',
    note: 'A biller decides whether a similar patient is this one.',
    config: {
      title: 'Choose the Patient',
      queue: QUEUE,
      instructions:
        'The reported patient is like patients already on file. Choose the same person, or add them as a new patient.',
      fields: [{ name: 'patientId', type: ID.patient, label: 'Patient', required: ['same'] }],
      outcomes: ['same', 'new'],
      hints: { same: 'Use the patient chosen.', new: 'Add the reported person as a new patient.' }
    }
  });
  g.ret('found', 'matched');
  g.ret('added', 'matched');
  g.ret('chosen', 'matched');
  g.ret('incomplete', 'incomplete');
  g.wire('entry.exec', 'find.exec');
  g.wire('entry.person', 'find.person', 'add.person');
  g.wire('find.matched', 'found.exec');
  g.wire('find.patientId', 'found.patientId');
  g.wire('find.notFound', 'add.exec');
  g.wire('add.then', 'added.exec');
  g.wire('add.patientId', 'added.patientId');
  g.wire('find.similar', 'choose.exec');
  g.wire(options, 'choose.options');
  g.wire(subjectOf(g), 'choose.subject');
  g.wire('choose.same', 'chosen.exec');
  g.wire('choose.patientId', 'chosen.patientId');
  g.wire('choose.new', 'add.exec');
  g.wire('find.incomplete', 'incomplete.exec');
  return g.def;
};

const resolvePatient = (): GraphDef => {
  const g = stage([PERSON_IN], [PATIENT_OUT], {
    resolved: exit('Resolved', 'The patient is known, found or added.')
  });
  breakRecord(
    g,
    'person',
    n('Person', 'The name and birth date as reported.'),
    PERSON,
    'entry.person'
  );
  g.add('match', 'billing.match-patient', {
    label: 'Match Patient',
    note: 'Matches the patient, or says the report is too thin to.'
  });
  g.add('defaults', 'std.object.make', {
    label: 'Details Reported',
    note: 'Prefills the task with what the report gave.',
    config: { fields: IDENTITY.map((name) => ({ name, type: 'string' })) } as Json
  });
  g.add('complete', 'std.human.task', {
    label: 'Complete the Patient',
    note: 'A biller fills in the name and birth date the report left out.',
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
    }
  });
  g.add('completed', 'person.make', {
    label: 'Person Completed',
    note: 'The patient with the biller’s details.'
  });
  g.add('matchCompleted', 'billing.match-patient', {
    label: 'Match the Completed Patient',
    note: 'Matches again with the completed details.'
  });
  g.add('stillIncomplete', 'std.flow.fail', {
    label: 'Still Not Enough to Match',
    note: 'Stops for inspection rather than guess a patient.',
    values: { message: 'The completed patient still has no last name or birth date' }
  });
  g.ret('matched', 'resolved');
  g.ret('matchedCompleted', 'resolved');
  g.wire('entry.exec', 'match.exec');
  g.wire('entry.person', 'match.person');
  g.wire('match.matched', 'matched.exec');
  g.wire('match.patientId', 'matched.patientId');
  g.wire('match.incomplete', 'complete.exec');
  g.wire(subjectOf(g), 'complete.subject');
  for (const field of IDENTITY) g.wire(`person.${field}`, `defaults.${field}`);
  g.wire('defaults.object', 'complete.defaults');
  for (const field of PERSON.fields.map((f) => f.name)) {
    g.wire(`${IDENTITY.includes(field) ? 'complete' : 'person'}.${field}`, `completed.${field}`);
  }
  g.wire('complete.save', 'matchCompleted.exec');
  g.wire('completed.person', 'matchCompleted.person');
  g.wire('matchCompleted.matched', 'matchedCompleted.exec');
  g.wire('matchCompleted.patientId', 'matchedCompleted.patientId');
  g.wire('matchCompleted.incomplete', 'stillIncomplete.exec');
  return g.def;
};

export const patientGraphs: SeedGraph[] = [
  asRule(
    'billing.patient-choice',
    'Patient Choice',
    'One patient like the reported one, as a choice in a form: the patient ID, labelled with their name and birth date.',
    choiceRule(
      {
        description: 'A patient like the one reported.',
        fields: { patientId: ID.patient, name: 'string', birthDate: 'string' },
        value: 'patientId'
      },
      {
        template: '{name}, born {birthDate}',
        description: 'The patient as a choice in a form: the ID and their name and birth date.'
      }
    )
  ),
  asStage(
    'billing.match-patient',
    'Match Patient',
    'Finds the patient on file or adds them. When patients on file are only similar, a biller chooses the same person or a new patient.',
    matchPatient()
  ),
  asStage(
    'billing.resolve-patient',
    'Resolve Patient',
    'Matches the patient an encounter is for. When the report does not name them well enough, a biller completes their details and the completed patient is matched the same way.',
    resolvePatient()
  )
];
