import { CLAIM } from '@ugula/billing';
import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  asStage,
  asWorkflow,
  breakRecord,
  CODE,
  d,
  ENCOUNTER,
  exit,
  flow,
  ID,
  joinLists,
  listOf,
  PAYMENT,
  QUEUE,
  stage,
  T
} from './shared.ts';

const CLASSIFICATION_OUT = d(
  'classification',
  CODE.classification,
  'Classification',
  'What kind of trip the encounter was.'
);

const CLAIM_REASONS = d(
  'reasons',
  listOf('string'),
  'Reasons',
  'Why the encounter was or was not billed this way.'
);

const REVISION_OUT = d(
  'revision',
  'integer',
  'Revision',
  'Which version of the claim was saved; a review decides one revision.',
  true
);

const REVIEW_OUTCOMES = {
  approved: exit('Approved', 'A biller approved the claim; it is ready for the clearinghouse.'),
  held: exit('Held', 'A biller put the claim on hold, with a note saying why.'),
  superseded: exit(
    'Superseded',
    'The claim was revised before the biller decided; the new revision has its own review.'
  )
};

const reviewClaim = (): GraphDef => {
  const g = stage(
    [
      d('claimId', ID.claim, 'Claim', 'The claim to review.'),
      d('revision', 'integer', 'Revision', 'The revision of the claim to review.'),
      d('subject', 'string', 'Subject', 'What the review is about, such as the PCR number.', true),
      d(
        'reasons',
        listOf('string'),
        'Reasons',
        'Why the claim was built this way, and what the checks flagged.'
      )
    ],
    [],
    REVIEW_OUTCOMES
  );
  g.add('review', 'std.human.task', {
    label: 'Review the Claim',
    config: {
      title: 'Review the Claim',
      queue: QUEUE,
      permission: 'claims:approve',
      instructions:
        'A biller must review every claim before it goes to the clearinghouse. Check the claim, the encounter and every reason, especially what the checks flagged. Approve it when it is ready to send, or put it on hold and say why.',
      fields: [
        {
          name: 'note',
          type: 'string',
          label: 'Note',
          required: ['hold']
        }
      ],
      outcomes: ['approve', 'hold'],
      hints: {
        approve: 'Ready for the clearinghouse.',
        hold: 'Not ready; the note says why.'
      }
    }
  });
  const record = (id: string, label: string, decision: string) => {
    g.add(id, 'claim.review', { label, values: { decision } });
    g.wire('entry.claimId', `${id}.claimId`);
    g.wire('entry.revision', `${id}.revision`);
    g.wire('review.completedBy', `${id}.reviewedBy`);
    g.wire('review.note', `${id}.note`);
    g.wire(`${id}.superseded`, 'superseded.exec');
  };
  record('approve', 'Record the Approval', 'approved');
  record('hold', 'Record the Hold', 'on_hold');
  g.ret('approved', 'approved');
  g.ret('held', 'held');
  g.ret('superseded', 'superseded');
  g.wire('entry.exec', 'review.exec');
  g.wire('entry.subject', 'review.subject');
  g.wire('entry.reasons', 'review.context');
  g.wire('review.approve', 'approve.exec');
  g.wire('review.hold', 'hold.exec');
  g.wire('approve.recorded', 'approved.exec');
  g.wire('hold.recorded', 'held.exec');
  return g.def;
};

const buildClaim = (): GraphDef => {
  const g = stage(
    [d('encounter', T.encounter, 'Encounter', 'The encounter to bill.')],
    [
      d(
        'claimId',
        ID.claim,
        'Claim',
        'The claim saved, ready for review, when the trip is billed.',
        true
      ),
      REVISION_OUT,
      CLASSIFICATION_OUT,
      CLAIM_REASONS
    ],
    {
      saved: exit('Saved', 'The claim is saved and needs review.'),
      notBillable: exit('Not Billable', 'The trip is not billed, so no claim was made.')
    }
  );
  breakRecord(g, 'trip', 'Encounter', ENCOUNTER, 'entry.encounter');
  breakRecord(g, 'payment', 'Payment', PAYMENT, 'trip.payment');
  g.add('classify', 'billing.trip-classification', { label: 'Trip Classification' });
  g.add('billable', 'std.flow.branch', { label: 'Is Billable' });
  g.add('patient', 'billing.resolve-patient', { label: 'Resolve Patient' });
  g.add('service', 'billing.service-details', { label: 'Service Details' });
  g.add('diagnoses', 'billing.diagnoses', { label: 'Diagnoses' });
  g.add('ambulance', 'billing.ambulance-details', { label: 'Ambulance Details' });
  g.add('checks', 'billing.claim-checks', { label: 'Claim Checks' });
  g.wire('entry.encounter', 'checks.encounter');
  g.wire('service.serviceDate', 'checks.serviceDate');
  g.wire('service.emergency', 'checks.emergency');
  g.wire('diagnoses.diagnoses', 'checks.diagnoses');
  g.add('places', 'billing.origin-and-destination', { label: 'Origin and Destination' });
  g.add('payers', 'billing.determine-payers', { label: 'Determine Payers' });
  g.add('primary', 'std.list.first', { label: 'Primary Coverage' });
  g.add('primaryPayer', 'coverage.break', { label: 'Primary Payer' });
  g.add('charges', 'billing.assign-charges', { label: 'Assign Charges' });
  g.add('claim', 'claim.make', { label: 'Claim' });
  g.add('save', 'claim.save', { label: 'Save Claim' });
  g.ret('notBilled', 'notBillable');
  g.ret('created', 'saved');
  g.ret('replaced', 'saved');
  g.wire(
    'entry.encounter',
    'classify.encounter',
    'service.encounter',
    'diagnoses.encounter',
    'ambulance.encounter'
  );
  for (const pin of ['transportReason', 'conditionCodes', 'weightPounds']) {
    g.wire(`ambulance.${pin}`, `claim.${pin}`);
  }
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
  g.wire(
    'classify.classification',
    'charges.classification',
    'payers.classification',
    'checks.classification',
    'claim.classification'
  );
  g.wire('trip.transportMethod', 'charges.transportMethod');
  g.wire('trip.patientsTransported', 'charges.patientsTransported');
  g.wire('payment.transportReason', 'charges.transportReason');
  g.wire('payment.closestFacilityMiles', 'charges.closestFacilityMiles');
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
    'payers.reasons',
    'charges.reasons',
    'checks.reasons'
  ]);
  g.wire(reasons, 'claim.reasons');
  g.wire('charges.charged', 'save.exec');
  g.wire(`claim.${CLAIM.name}`, 'save.claim');
  for (const outcome of ['created', 'replaced']) {
    g.wire(`save.${outcome}`, `${outcome}.exec`);
    g.wire('save.claimId', `${outcome}.claimId`);
    g.wire('save.revision', `${outcome}.revision`);
    g.wire('classify.classification', `${outcome}.classification`);
    g.wire(reasons, `${outcome}.reasons`);
  }
  g.wire('classify.classification', 'notBilled.classification');
  g.wire('classify.reasons', 'notBilled.reasons');
  return g.def;
};

const fromEncounter = (event: string) => {
  const g = flow(
    [d('encounterId', ID.encounter, 'Encounter', 'The encounter saved.')],
    [
      d('claimId', ID.claim, 'Claim', 'The claim saved, when the trip is billed.', true),
      CLASSIFICATION_OUT,
      CLAIM_REASONS
    ]
  );
  g.trigger({ kind: 'event', event, where: {} });
  g.add('read', 'encounter.read', { label: 'Read Encounter' });
  g.add('build', 'billing.build-claim', { label: 'Build Claim' });
  g.add('review', 'billing.review-claim', { label: 'Review Claim' });
  const billed = Object.keys(REVIEW_OUTCOMES);
  for (const outcome of billed) g.ret(outcome);
  g.ret('notBilled');
  g.wire('entry.exec', 'read.exec');
  g.wire('entry.encounterId', 'read.encounterId');
  g.wire('read.then', 'build.exec');
  g.wire('read.encounter', 'build.encounter');
  g.wire('build.saved', 'review.exec');
  g.wire('build.claimId', 'review.claimId');
  g.wire('build.revision', 'review.revision');
  g.wire('read.encounter', 'pcr.encounter');
  g.add('pcr', 'encounter.break', { label: 'Encounter' });
  g.wire('pcr.pcrNumber', 'review.subject');
  g.wire('build.reasons', 'review.reasons');
  g.wire('build.notBillable', 'notBilled.exec');
  for (const outcome of billed) {
    g.wire(`review.${outcome}`, `${outcome}.exec`);
    g.wire('build.claimId', `${outcome}.claimId`);
  }
  for (const ret of [...billed, 'notBilled']) {
    g.wire('build.classification', `${ret}.classification`);
    g.wire('build.reasons', `${ret}.reasons`);
  }
  return g.def;
};

export const claimGraphs: SeedGraph[] = [
  asStage(
    'billing.review-claim',
    'Review Claim',
    'Ends every claim on review by a biller, as the law requires before a claim goes to the clearinghouse: a Review the Claim task that only someone allowed to approve claims can complete. Approved makes the claim ready for the clearinghouse; On Hold keeps it back with a note. A claim revised during the review is decided in its own review.',
    reviewClaim()
  ),
  asStage(
    'billing.build-claim',
    'Build Claim',
    'Builds and saves the claim for an encounter: classifies the trip, and when it is billed resolves the patient, decides the service, diagnoses, modifier and payers, prices the charges and saves the claim for review.',
    buildClaim()
  ),
  asWorkflow(
    'billing.encounter-to-claim',
    'Encounter to Claim',
    'When an encounter is created, builds its claim, saves it and has a biller review it before it can go to the clearinghouse, or records why the trip is not billed.',
    fromEncounter('encounter.created')
  ),
  asWorkflow(
    'billing.revised-encounter-to-claim',
    'Revised Encounter to Claim',
    'When a changed copy of a PCR revises an encounter, builds its claim again, saves it over the one before as a new revision and has a biller review it again, even when the one before was approved.',
    fromEncounter('encounter.revised')
  )
];
