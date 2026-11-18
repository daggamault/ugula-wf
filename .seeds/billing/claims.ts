import {
  CLAIM,
  CLASSIFICATION_LABELS,
  CLASSIFICATIONS,
  LOCATION,
  ORIGIN_DESTINATION_CODES
} from '@ugula/billing';
import type { GraphDef, Model } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  ADDRESS,
  allOf,
  asStage,
  asWorkflow,
  BILLABLE_KINDS,
  type Builder,
  breakRecord,
  CODE,
  codes,
  DESTINATION,
  d,
  ENCOUNTER,
  exit,
  flow,
  ID,
  isCode,
  isIn,
  isMissing,
  joinLists,
  listOf,
  n,
  not,
  PAYMENT,
  type Port,
  QUEUE,
  SCENE,
  stage,
  T,
  TRANSPORT_KINDS
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
    note: 'A biller must approve every claim before it goes out.',
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
    g.add(id, 'claim.review', {
      label,
      note: 'Records the decision for the revision the biller saw.',
      values: { decision }
    });
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

const CHOSEN_KINDS = CLASSIFICATIONS.filter((c) => c !== 'unknown').map((value) => ({
  value,
  label: CLASSIFICATION_LABELS[value]
}));

const settleClassification = (): GraphDef => {
  const g = stage(
    [
      d('classification', CODE.classification, 'Classification', 'What the rules decided.'),
      d('subject', 'string', 'Subject', 'What the trip is, such as the PCR number.', true),
      d('reasons', listOf('string'), 'Reasons', 'Why the rules decided as they did.')
    ],
    [
      d('classification', CODE.classification, 'Classification', 'What kind of trip it was.'),
      d('billable', 'boolean', 'Billable', 'Whether the trip is billed.')
    ],
    { settled: exit('Settled', 'The trip has a kind, from the rules or a biller.') },
    [{ name: 'kind', type: CODE.classification, default: null }]
  );
  g.add('decided', 'std.var.set', {
    label: 'Remember What the Rules Decided',
    note: 'Starts from the rules; a biller replaces it only when the rules could not decide.',
    config: { name: 'kind' }
  });
  g.add('unknown', 'std.flow.branch', {
    label: 'Rules Could Not Decide',
    note: 'An unknown trip goes to a biller instead of being guessed.'
  });
  isCode(
    g,
    'isUnknown',
    n('Is Unknown', 'Whether the rules left the kind of trip unknown.'),
    'tripClassification',
    'entry.classification',
    'unknown'
  );
  g.add('ask', 'std.human.task', {
    label: 'Classify the Trip',
    note: 'A biller reads the report and says what kind of trip it was.',
    config: {
      title: 'Classify the Trip',
      queue: QUEUE,
      instructions:
        'The report does not say clearly enough what kind of trip this was, or it contradicts itself. Read the dispositions, times, destination and narrative, and choose what happened. Choose Not Billable when there was no patient to bill for.',
      fields: [
        {
          name: 'classification',
          type: CODE.classification,
          label: 'Kind of Trip',
          options: CHOSEN_KINDS,
          required: ['classify']
        }
      ],
      outcomes: ['classify'],
      hints: { classify: 'Bill the trip as the kind chosen.' }
    }
  });
  g.add('chosen', 'std.var.set', {
    label: 'Remember What the Biller Chose',
    note: 'The biller’s choice replaces unknown.',
    config: { name: 'kind' }
  });
  g.add('kind', 'std.var.get', {
    label: 'Kind of Trip',
    note: 'What the rules or the biller decided.',
    config: { name: 'kind' }
  });
  const billable = isIn(
    g,
    'billable',
    n('Billable Kind of Trip', 'Whether this kind of trip is billed.'),
    'tripClassification',
    'kind.value',
    codes(
      g,
      'billableKinds',
      n(
        'Billable Kinds of Trip',
        'Transports, pronounced dead, treatment and refusal without transport.'
      ),
      'tripClassification',
      BILLABLE_KINDS
    )
  );
  g.ret('return', 'settled');
  g.wire('kind.value', 'return.classification');
  g.wire(billable, 'return.billable');
  g.wire('entry.exec', 'decided.exec');
  g.wire('entry.classification', 'decided.value');
  g.wire('decided.then', 'unknown.exec');
  g.wire('isUnknown.result', 'unknown.condition');
  g.wire('unknown.false', 'return.exec');
  g.wire('unknown.true', 'ask.exec');
  g.wire('entry.subject', 'ask.subject');
  g.wire('entry.reasons', 'ask.context');
  g.wire('ask.classify', 'chosen.exec');
  g.wire('ask.classification', 'chosen.value');
  g.wire('chosen.then', 'return.exec');
  return g.def;
};

const settleMiles = (): GraphDef => {
  const g = stage(
    [
      d('classification', CODE.classification, 'Classification', 'What kind of trip it was.'),
      d('loadedMiles', 'number', 'Loaded Miles', 'The miles the rules found, if any.', true),
      d('subject', 'string', 'Subject', 'What the trip is, such as the PCR number.', true),
      d('reasons', listOf('string'), 'Reasons', 'Why the trip was billed this way.')
    ],
    [
      d(
        'loadedMiles',
        'number',
        'Loaded Miles',
        'Miles with the patient on board, when billed.',
        true
      )
    ],
    { settled: exit('Settled', 'A transport has its miles, from the report or a biller.') },
    [{ name: 'miles', type: 'number', default: null }]
  );
  g.add('found', 'std.var.set', {
    label: 'Remember the Miles Found',
    note: 'Starts from the odometer or narrative miles.',
    config: { name: 'miles' }
  });
  g.add('missing', 'std.flow.branch', {
    label: 'Transport Without Miles',
    note: 'A transport needs loaded miles on the claim; a biller enters them when the report has none.'
  });
  allOf(g, 'needsMiles', n('Transport Without Miles', 'Transported, and no miles found.'), [
    isIn(
      g,
      'transported',
      n('Transported', 'Only transports bill mileage.'),
      'tripClassification',
      'entry.classification',
      codes(
        g,
        'transportKinds',
        n('Kinds of Transport', 'Emergency and scheduled.'),
        'tripClassification',
        TRANSPORT_KINDS
      )
    ),
    isMissing(
      g,
      'noMiles',
      n('No Miles Found', 'Neither the odometer nor the narrative gave miles.'),
      'entry.loadedMiles'
    )
  ]);
  g.add('ask', 'std.human.task', {
    label: 'Enter the Loaded Miles',
    note: 'A biller finds the miles in the run sheet, CAD or a map.',
    config: {
      title: 'Enter the Loaded Miles',
      queue: QUEUE,
      instructions:
        'The report has no odometer readings and the narrative gives no miles. Find the miles the patient was on board, from the CAD record, the run sheet or a map from the pickup to the destination, and enter them. CMS wants tenths under 100 miles and whole miles from 100, rounded up.',
      fields: [
        {
          name: 'miles',
          type: 'number',
          label: 'Loaded Miles',
          min: 0.1,
          max: 1000,
          required: ['enter']
        }
      ],
      outcomes: ['enter'],
      hints: { enter: 'Bill these miles.' }
    }
  });
  g.add('entered', 'std.var.set', {
    label: 'Remember the Miles Entered',
    note: 'The biller’s miles replace the missing ones.',
    config: { name: 'miles' }
  });
  g.add('miles', 'std.var.get', {
    label: 'Loaded Miles',
    note: 'Found or entered.',
    config: { name: 'miles' }
  });
  g.ret('return', 'settled');
  g.wire('miles.value', 'return.loadedMiles');
  g.wire('entry.exec', 'found.exec');
  g.wire('entry.loadedMiles', 'found.value');
  g.wire('found.then', 'missing.exec');
  g.wire('needsMiles.result', 'missing.condition');
  g.wire('missing.false', 'return.exec');
  g.wire('missing.true', 'ask.exec');
  g.wire('entry.subject', 'ask.subject');
  g.wire('entry.reasons', 'ask.context');
  g.wire('ask.enter', 'entered.exec');
  g.wire('ask.miles', 'entered.value');
  g.wire('entered.then', 'return.exec');
  return g.def;
};

const PLACES = Object.entries(ORIGIN_DESTINATION_CODES).map(([value, description]) => ({
  value,
  label: `${description} (${value})`
}));

const settlePlaces = (): GraphDef => {
  const g = stage(
    [
      d('classification', CODE.classification, 'Classification', 'What kind of trip it was.'),
      d('originCode', CODE.place, 'Origin', 'The origin letter the rules found, if any.', true),
      d('destinationCode', CODE.place, 'Destination', 'The destination letter, if any.', true),
      d('complete', 'boolean', 'Both Known', 'Whether the rules found both letters.'),
      d('subject', 'string', 'Subject', 'What the trip is, such as the PCR number.', true),
      d('reasons', listOf('string'), 'Reasons', 'Why the letters are what they are.')
    ],
    [
      d('originCode', CODE.place, 'Origin', 'The origin letter, when billed.', true),
      d('destinationCode', CODE.place, 'Destination', 'The destination letter, when billed.', true)
    ],
    { settled: exit('Settled', 'A transport has both letters, from the report or a biller.') },
    [
      { name: 'origin', type: CODE.place, default: null },
      { name: 'destination', type: CODE.place, default: null }
    ]
  );
  g.add('foundOrigin', 'std.var.set', {
    label: 'Remember the Origin Found',
    note: 'Starts from the letters the rules found.',
    config: { name: 'origin' }
  });
  g.add('foundDestination', 'std.var.set', {
    label: 'Remember the Destination Found',
    note: 'Starts from the letters the rules found.',
    config: { name: 'destination' }
  });
  g.add('missing', 'std.flow.branch', {
    label: 'Transport Without Both Letters',
    note: 'Every transport line needs the origin and destination modifier.'
  });
  allOf(
    g,
    'needsPlaces',
    n('Transport Without Both Letters', 'Transported, and a letter unknown.'),
    [
      isIn(
        g,
        'transported',
        n('Transported', 'Only transports need the modifier.'),
        'tripClassification',
        'entry.classification',
        codes(
          g,
          'transportKinds',
          n('Kinds of Transport', 'Emergency and scheduled.'),
          'tripClassification',
          TRANSPORT_KINDS
        )
      ),
      not(
        g,
        'incomplete',
        n('A Letter Unknown', 'The rules could not find both.'),
        'entry.complete'
      )
    ]
  );
  g.add('ask', 'std.human.task', {
    label: 'Set the Origin and Destination',
    note: 'A biller reads where the trip started and ended.',
    config: {
      title: 'Set the Origin and Destination',
      queue: QUEUE,
      instructions:
        'The report does not say clearly what kind of place the patient was picked up at or taken to. Read the scene, destination and narrative, and choose both letters of the origin and destination modifier.',
      fields: [
        { name: 'origin', type: CODE.place, label: 'Origin', options: PLACES, required: ['set'] },
        {
          name: 'destination',
          type: CODE.place,
          label: 'Destination',
          options: PLACES,
          required: ['set']
        }
      ],
      outcomes: ['set'],
      hints: { set: 'Bill the modifier these letters make.' }
    }
  });
  g.add('setOrigin', 'std.var.set', {
    label: 'Remember the Origin Chosen',
    note: 'The biller’s letter replaces the rules’.',
    config: { name: 'origin' }
  });
  g.add('setDestination', 'std.var.set', {
    label: 'Remember the Destination Chosen',
    note: 'The biller’s letter replaces the rules’.',
    config: { name: 'destination' }
  });
  g.add('origin', 'std.var.get', {
    label: 'Origin',
    note: 'Found or chosen.',
    config: { name: 'origin' }
  });
  g.add('destination', 'std.var.get', {
    label: 'Destination',
    note: 'Found or chosen.',
    config: { name: 'destination' }
  });
  g.ret('return', 'settled');
  g.wire('origin.value', 'return.originCode');
  g.wire('destination.value', 'return.destinationCode');
  g.wire('entry.exec', 'foundOrigin.exec');
  g.wire('entry.originCode', 'foundOrigin.value');
  g.wire('foundOrigin.then', 'foundDestination.exec');
  g.wire('entry.destinationCode', 'foundDestination.value');
  g.wire('foundDestination.then', 'missing.exec');
  g.wire('needsPlaces.result', 'missing.condition');
  g.wire('missing.false', 'return.exec');
  g.wire('missing.true', 'ask.exec');
  g.wire('entry.subject', 'ask.subject');
  g.wire('entry.reasons', 'ask.context');
  g.wire('ask.set', 'setOrigin.exec');
  g.wire('ask.origin', 'setOrigin.value');
  g.wire('setOrigin.then', 'setDestination.exec');
  g.wire('ask.destination', 'setDestination.value');
  g.wire('setDestination.then', 'return.exec');
  return g.def;
};

const claimLocation = (
  g: Builder,
  id: string,
  label: string,
  place: Pick<Model, 'key' | 'name'>,
  from: Port
) => {
  breakRecord(
    g,
    `${id}Place`,
    n(label, 'Its name and address, as the report gives them.'),
    place,
    from
  );
  breakRecord(
    g,
    `${id}Address`,
    n(`${label} Address`, 'The street, city, state and ZIP.'),
    ADDRESS,
    `${id}Place.address`
  );
  g.add(id, `${LOCATION.key}.make`, {
    label: `${label} on the Claim`,
    note: 'The place the claim names, for the ambulance pickup or drop-off location.'
  });
  g.wire(`${id}Place.name`, `${id}.name`);
  for (const pin of ['line', 'city', 'state', 'postalCode']) {
    g.wire(`${id}Address.${pin}`, `${id}.${pin}`);
  }
  return `${id}.${LOCATION.name}` as Port;
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
  breakRecord(
    g,
    'trip',
    n('Encounter', 'The parts of the encounter the claim needs.'),
    ENCOUNTER,
    'entry.encounter'
  );
  breakRecord(
    g,
    'payment',
    n('Payment', 'Billing details the report gives.'),
    PAYMENT,
    'trip.payment'
  );
  g.add('classify', 'billing.trip-classification', {
    label: 'Trip Classification',
    note: 'Decides what kind of trip it was.'
  });
  g.add('settle', 'billing.settle-classification', {
    label: 'Settle the Trip',
    note: 'A biller classifies the trip when the rules could not.'
  });
  g.add('billable', 'std.flow.branch', {
    label: 'Is Billable',
    note: 'Only billable trips get a claim.'
  });
  g.add('miles', 'billing.settle-miles', {
    label: 'Settle the Miles',
    note: 'A biller enters the miles when a transport has none.'
  });
  g.add('setPlaces', 'billing.settle-places', {
    label: 'Settle the Origin and Destination',
    note: 'A biller sets the letters when a transport is missing one.'
  });
  g.add('patient', 'billing.resolve-patient', {
    label: 'Resolve Patient',
    note: 'Finds or adds the patient, asking a biller when unsure.'
  });
  g.add('service', 'billing.service-details', {
    label: 'Service Details',
    note: 'Level, emergency, miles and date.'
  });
  g.add('diagnoses', 'billing.diagnoses', {
    label: 'Reported Diagnoses',
    note: 'The impressions and symptoms as the report gives them.'
  });
  g.add('dx', 'billing.code-diagnoses', {
    label: 'Code the Diagnoses',
    note: 'Keeps billable codes; a coder chooses when none can be billed first.'
  });
  g.add('ambulance', 'billing.ambulance-details', {
    label: 'Ambulance Details',
    note: 'Transport reason, conditions and weight for CR1 and CRC.'
  });
  g.add('checks', 'billing.claim-checks', {
    label: 'Claim Checks',
    note: 'What to fix or confirm before the claim goes out.'
  });
  g.wire('entry.encounter', 'checks.encounter');
  g.wire('service.serviceDate', 'checks.serviceDate');
  g.wire('service.emergency', 'checks.emergency');
  g.wire('setPlaces.originCode', 'checks.originCode');
  g.wire('setPlaces.destinationCode', 'checks.destinationCode');
  g.wire('dx.diagnoses', 'checks.diagnoses');
  g.wire('entry.encounter', 'dx.encounter');
  g.wire('diagnoses.diagnoses', 'dx.reported');
  g.add('places', 'billing.origin-and-destination', {
    label: 'Origin and Destination',
    note: 'The origin and destination letters the report shows.'
  });
  g.add('payers', 'billing.determine-payers', {
    label: 'Determine Payers',
    note: 'Who is billed, in what order.'
  });
  g.add('primary', 'std.list.first', {
    label: 'Primary Coverage',
    note: 'The payer billed first.'
  });
  g.add('primaryPayer', 'coverage.break', {
    label: 'Primary Payer',
    note: 'Its fees price the lines.'
  });
  g.add('charges', 'billing.assign-charges', {
    label: 'Assign Charges',
    note: 'The lines, priced, and the total.'
  });
  g.add('claim', 'claim.make', { label: 'Claim', note: 'Puts the claim together.' });
  g.add('save', 'claim.save', { label: 'Save Claim', note: 'Saves it as Needs Review.' });
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
  g.wire(claimLocation(g, 'pickup', 'Pickup', SCENE, 'trip.pickup'), 'claim.pickup');
  g.wire(
    claimLocation(g, 'dropoff', 'Destination', DESTINATION, 'trip.destination'),
    'claim.destination'
  );
  g.wire('payment.priorAuthorization', 'claim.priorAuthorization');
  g.wire('checks.signatureOnFile', 'claim.signatureOnFile');
  g.wire('entry.encounter', 'places.encounter', 'payers.encounter');
  g.wire('trip.patient', 'patient.person');
  g.wire('entry.exec', 'settle.exec');
  g.wire('classify.classification', 'settle.classification');
  g.wire('classify.reasons', 'settle.reasons');
  g.wire('trip.pcrNumber', 'settle.subject');
  g.wire('settle.settled', 'billable.exec');
  g.wire('settle.billable', 'billable.condition');
  g.wire('billable.false', 'notBilled.exec');
  g.wire('billable.true', 'miles.exec');
  g.wire('settle.classification', 'miles.classification');
  g.wire('service.loadedMiles', 'miles.loadedMiles');
  g.wire('trip.pcrNumber', 'miles.subject');
  g.wire('service.reasons', 'miles.reasons');
  g.wire('miles.settled', 'setPlaces.exec');
  g.wire('settle.classification', 'setPlaces.classification');
  for (const pin of ['originCode', 'destinationCode', 'complete', 'reasons']) {
    g.wire(`places.${pin}`, `setPlaces.${pin}`);
  }
  g.wire('trip.pcrNumber', 'setPlaces.subject');
  g.wire('setPlaces.settled', 'dx.exec');
  g.wire('dx.coded', 'patient.exec');
  g.wire('patient.resolved', 'payers.exec');
  g.wire('payers.determined', 'charges.exec');
  g.wire('payers.coverages', 'primary.list', 'claim.coverages');
  g.wire('primary.item', 'primaryPayer.coverage');
  g.wire('primaryPayer.payerId', 'charges.payerId');
  g.wire(
    'settle.classification',
    'charges.classification',
    'payers.classification',
    'checks.classification',
    'claim.classification'
  );
  g.wire('trip.transportMethod', 'charges.transportMethod');
  g.wire('trip.patientsTransported', 'charges.patientsTransported');
  g.wire('ambulance.transportReason', 'charges.transportReason');
  g.wire('payment.closestFacilityMiles', 'charges.closestFacilityMiles');
  for (const pin of ['level', 'emergency']) {
    g.wire(`service.${pin}`, `charges.${pin}`, `claim.${pin}`);
  }
  g.wire('miles.loadedMiles', 'charges.loadedMiles', 'claim.loadedMiles');
  for (const pin of ['originCode', 'destinationCode']) {
    g.wire(`setPlaces.${pin}`, `charges.${pin}`, `claim.${pin}`);
  }
  g.wire('trip.id', 'claim.encounterId');
  g.wire('patient.patientId', 'claim.patientId');
  g.wire('service.serviceDate', 'claim.serviceDate');
  g.wire('dx.diagnoses', 'claim.diagnoses');
  g.wire('charges.lines', 'claim.lines');
  g.wire('charges.totalCents', 'claim.totalCents');
  const reasons = joinLists(
    g,
    'reasons',
    n('Every Reason', 'Every reason, for the biller who reviews it.'),
    'string',
    [
      'classify.reasons',
      'service.reasons',
      'ambulance.reasons',
      'dx.reasons',
      'places.reasons',
      'payers.reasons',
      'charges.reasons',
      'checks.reasons'
    ]
  );
  g.wire(reasons, 'claim.reasons');
  g.wire('charges.charged', 'save.exec');
  g.wire(`claim.${CLAIM.name}`, 'save.claim');
  for (const outcome of ['created', 'replaced']) {
    g.wire(`save.${outcome}`, `${outcome}.exec`);
    g.wire('save.claimId', `${outcome}.claimId`);
    g.wire('save.revision', `${outcome}.revision`);
    g.wire('settle.classification', `${outcome}.classification`);
    g.wire(reasons, `${outcome}.reasons`);
  }
  g.wire('settle.classification', 'notBilled.classification');
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
  g.add('read', 'encounter.read', {
    label: 'Read Encounter',
    note: 'Reads the encounter the event names.'
  });
  g.add('build', 'billing.build-claim', {
    label: 'Build Claim',
    note: 'Builds and saves its claim, a new revision when revised, or says why not.'
  });
  g.add('review', 'billing.review-claim', {
    label: 'Review Claim',
    note: 'A biller reviews the claim before it goes out.'
  });
  const billed = Object.keys(REVIEW_OUTCOMES);
  for (const outcome of billed) g.ret(outcome);
  g.ret('notBilled');
  g.wire('entry.exec', 'read.exec');
  g.wire('entry.encounterId', 'read.encounterId');
  g.add('missing', 'std.flow.fail', {
    label: 'Encounter Missing',
    note: 'Stops for inspection when the encounter the event names is gone.',
    values: { message: 'The encounter the event names was not found' }
  });
  g.wire('read.found', 'build.exec');
  g.wire('read.notFound', 'missing.exec');
  g.wire('read.encounter', 'build.encounter');
  g.wire('build.saved', 'review.exec');
  g.wire('build.claimId', 'review.claimId');
  g.wire('build.revision', 'review.revision');
  g.wire('read.encounter', 'pcr.encounter');
  g.add('pcr', 'encounter.break', {
    label: 'Encounter',
    note: 'Names the review by its PCR number.'
  });
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
    'Ends every claim on review by a biller, as the law requires before a claim goes to the clearinghouse: a Review the Claim task that only someone allowed to approve claims can complete. Approved makes the claim ready for the clearinghouse; On Hold keeps it back with a note. A claim revised during the review is decided in its own review, and the review of the earlier revision is cancelled.',
    reviewClaim()
  ),
  asStage(
    'billing.settle-classification',
    'Settle the Trip',
    'Keeps the kind of trip the rules decided, or asks a biller to classify the trip when the rules could not decide, so a trip is never billed or dropped on a guess.',
    settleClassification()
  ),
  asStage(
    'billing.settle-miles',
    'Settle the Miles',
    'Keeps the loaded miles the rules found, or asks a biller to enter them when a transport has none, since a transport claim needs its mileage.',
    settleMiles()
  ),
  asStage(
    'billing.settle-places',
    'Settle the Origin and Destination',
    'Keeps the origin and destination letters the rules found, or asks a biller to set both when a transport is missing one, since every transport line needs the modifier.',
    settlePlaces()
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
