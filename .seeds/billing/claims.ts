import { CLAIM } from '@ugula/billing';
import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  asStage,
  asWorkflow,
  breakRecord,
  d,
  ENCOUNTER,
  exit,
  flow,
  joinLists,
  listOf,
  stage,
  T
} from './shared.ts';

const CLAIM_ID = { id: 'claim' } as const;

const ENCOUNTER_ID = { id: 'encounter' } as const;

const CLASSIFICATION_OUT = d(
  'classification',
  'string',
  'Classification',
  'What kind of trip the encounter was.'
);

const REASONS_OUT = d(
  'reasons',
  listOf('string'),
  'Reasons',
  'Why the encounter was or was not billed this way.'
);

const buildClaim = (): GraphDef => {
  const g = stage(
    [d('encounter', T.encounter, 'Encounter', 'The encounter to bill.')],
    [
      d(
        'claimId',
        CLAIM_ID,
        'Claim',
        'The claim saved, ready for review, when the trip is billed.',
        true
      ),
      CLASSIFICATION_OUT,
      REASONS_OUT
    ],
    {
      saved: exit('Saved', 'The claim is saved and needs review.'),
      notBillable: exit('Not Billable', 'The trip is not billed, so no claim was made.')
    }
  );
  breakRecord(g, 'trip', 'Encounter', ENCOUNTER, 'entry.encounter');
  g.add('classify', 'billing.trip-classification', { label: 'Trip Classification' });
  g.add('billable', 'std.flow.branch', { label: 'Billable?' });
  g.add('patient', 'billing.resolve-patient', { label: 'Resolve Patient' });
  g.add('service', 'billing.determine-service', { label: 'Determine Service' });
  g.add('diagnoses', 'billing.assign-diagnoses', { label: 'Assign Diagnoses' });
  g.add('places', 'billing.origin-and-destination', { label: 'Origin and Destination' });
  g.add('payers', 'billing.determine-payers', { label: 'Determine Payers' });
  g.add('primary', 'std.list.first', { label: 'Primary Coverage' });
  g.add('primaryPayer', 'coverage.break', { label: 'Primary Payer' });
  g.add('charges', 'billing.assign-charges', { label: 'Assign Charges' });
  g.add('claim', 'claim.make', { label: 'Claim' });
  g.add('save', 'claim.save', { label: 'Save the Claim' });
  g.ret('notBilled', 'notBillable');
  g.ret('created', 'saved');
  g.ret('replaced', 'saved');
  g.wire('entry.encounter', 'classify.encounter', 'service.encounter', 'diagnoses.encounter');
  g.wire('entry.encounter', 'places.encounter', 'payers.encounter');
  g.wire('trip.patient', 'patient.person');
  g.wire('entry.exec', 'billable.exec');
  g.wire('classify.billable', 'billable.condition');
  g.wire('billable.false', 'notBilled.exec');
  g.wire('billable.true', 'patient.exec');
  g.wire('patient.resolved', 'payers.exec');
  g.wire('payers.determined', 'charges.exec');
  g.wire('payers.coverages', 'primary.list', 'claim.coverages');
  g.wire('primary.item', 'primaryPayer.coverage');
  g.wire('primaryPayer.payerId', 'charges.payerId');
  g.wire('classify.classification', 'charges.classification', 'claim.classification');
  for (const pin of ['level', 'emergency', 'loadedMiles']) {
    g.wire(`service.${pin}`, `charges.${pin}`, `claim.${pin}`);
  }
  for (const pin of ['originCode', 'destinationCode']) {
    g.wire(`places.${pin}`, `charges.${pin}`, `claim.${pin}`);
  }
  g.wire('trip.id', 'claim.encounterId');
  g.wire('patient.patientId', 'claim.patientId');
  g.wire('service.serviceDate', 'claim.serviceDate');
  g.wire('diagnoses.diagnoses', 'claim.diagnoses');
  g.wire('charges.lines', 'claim.lines');
  g.wire('charges.totalCents', 'claim.totalCents');
  const reasons = joinLists(g, 'reasons', 'Every Reason', 'string', [
    'classify.reasons',
    'service.reasons',
    'places.reasons',
    'charges.reasons'
  ]);
  g.wire(reasons, 'claim.reasons');
  g.wire('charges.charged', 'save.exec');
  g.wire(`claim.${CLAIM.name}`, 'save.claim');
  for (const outcome of ['created', 'replaced']) {
    g.wire(`save.${outcome}`, `${outcome}.exec`);
    g.wire('save.claimId', `${outcome}.claimId`);
    g.wire('classify.classification', `${outcome}.classification`);
    g.wire(reasons, `${outcome}.reasons`);
  }
  g.wire('classify.classification', 'notBilled.classification');
  g.wire('classify.reasons', 'notBilled.reasons');
  return g.def;
};

const fromEncounter = (event: string) => {
  const g = flow(
    [d('encounterId', ENCOUNTER_ID, 'Encounter', 'The encounter saved.')],
    [
      d('claimId', CLAIM_ID, 'Claim', 'The claim saved, when the trip is billed.', true),
      CLASSIFICATION_OUT,
      REASONS_OUT
    ]
  );
  g.trigger({ kind: 'event', event, where: {} });
  g.add('read', 'encounter.read', { label: 'Read the Encounter' });
  g.add('build', 'billing.build-claim', { label: 'Build Claim' });
  g.ret('billed');
  g.ret('notBilled');
  g.wire('entry.exec', 'read.exec');
  g.wire('entry.encounterId', 'read.encounterId');
  g.wire('read.then', 'build.exec');
  g.wire('read.encounter', 'build.encounter');
  g.wire('build.saved', 'billed.exec');
  g.wire('build.notBillable', 'notBilled.exec');
  for (const ret of ['billed', 'notBilled']) {
    g.wire('build.classification', `${ret}.classification`);
    g.wire('build.reasons', `${ret}.reasons`);
  }
  g.wire('build.claimId', 'billed.claimId');
  return g.def;
};

export const claimGraphs: SeedGraph[] = [
  asStage(
    'billing.build-claim',
    'Build Claim',
    'Builds and saves the claim for an encounter: classifies the trip, and when it is billed resolves the patient, decides the service, diagnoses, modifier and payers, prices the charges and saves the claim for review.',
    buildClaim()
  ),
  asWorkflow(
    'billing.encounter-to-claim',
    'Encounter to Claim',
    'When an encounter is created, builds its claim and saves it for review, or records why the trip is not billed.',
    fromEncounter('encounter.created')
  ),
  asWorkflow(
    'billing.encounter-revised',
    'Encounter Revised',
    'When a changed copy of a PCR revises an encounter, builds its claim again and saves it over the one under review.',
    fromEncounter('encounter.revised')
  )
];
