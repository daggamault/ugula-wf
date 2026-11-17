import type { GraphDef, Json, ValueType } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  asRule,
  asStage,
  condition,
  d,
  exit,
  firstOf,
  fixed,
  makeObject,
  orElse,
  P,
  type Port,
  reasonsOf,
  rule,
  select,
  stage,
  summary,
  T
} from './shared.ts';

const PICKUP_IN = d(
  'pickupFacility',
  T.facility,
  'Pickup Facility',
  'The directory facility at the pickup.',
  true
);

const DESTINATION_IN = d(
  'destinationFacility',
  T.facility,
  'Destination Facility',
  'The directory facility at the destination.',
  true
);

const PARTY_OUT = d(
  'party',
  'string',
  'Responsible Party',
  'Who the claim is billed to: payer or facility.'
);

const FACILITY_ID_OUT = d(
  'facilityId',
  { id: 'facility' },
  'Responsible Facility',
  'The directory facility billed, when one is known.',
  true
);

const FACILITY_NAME_OUT = d(
  'facilityName',
  'string',
  'Facility Name',
  'The name of the facility billed, when one is known.',
  true
);

const facilityResponsibility = (): GraphDef => {
  const g = rule(
    [
      d(
        'recordedParty',
        'string',
        'Recorded Party',
        'Who the claim was already recorded as billed to (payer or facility), if anyone.',
        true
      ),
      d(
        'facilityStay',
        'string',
        'Facility Stay',
        'The stay a biller confirmed: none, inpatient (a hospital Part A stay) or snf (a skilled nursing Part A stay).',
        true
      ),
      d('emergency', 'boolean', 'Emergency', 'Whether the trip is billed as an emergency.', true),
      PICKUP_IN,
      DESTINATION_IN
    ],
    [PARTY_OUT, FACILITY_ID_OUT, FACILITY_NAME_OUT, P.reasons('the claim is billed to that party')]
  );
  g.add('pickup', 'billing.facility.break', { label: 'Pickup Facility' });
  g.add('destination', 'billing.facility.break', { label: 'Destination Facility' });
  const recorded = (id: string, label: string, party: string) =>
    condition(g, id, label, { recordedParty: ['string', 'entry.recordedParty'] }, [
      { field: 'recordedParty', op: 'is', value: party }
    ]);
  const stay: [ValueType, Port] = ['string', 'entry.facilityStay'];
  const rules = [
    {
      id: 'payers',
      label: 'Payers Chosen',
      bill: 'payer',
      reason: 'A biller chose to bill the payers',
      when: recorded('payersChosen', 'A Biller Chose the Payers', 'payer')
    },
    {
      id: 'recorded',
      label: 'Facility Recorded',
      bill: 'recorded',
      reason: 'Already billed to the facility',
      when: recorded('facilityRecorded', 'Already Billed to the Facility', 'facility')
    },
    {
      id: 'contract',
      label: 'Contract Facility',
      bill: 'contract',
      reason: 'Transport to or from a contract facility',
      when: condition(
        g,
        'contractEnd',
        'Either End Under Contract',
        {
          pickupContract: ['boolean', 'pickup.contract'],
          destinationContract: ['boolean', 'destination.contract']
        },
        [
          { field: 'pickupContract', op: 'is', value: true },
          { field: 'destinationContract', op: 'is', value: true }
        ],
        'any'
      )
    },
    {
      id: 'inpatient',
      label: 'Hospital Inpatient',
      bill: 'pickup',
      reason: 'Hospital inpatient who stays admitted (Part A)',
      when: condition(g, 'inpatientStay', 'A Hospital Inpatient Stay', { facilityStay: stay }, [
        { field: 'facilityStay', op: 'is', value: 'inpatient' }
      ])
    },
    {
      id: 'snf',
      label: 'Skilled Nursing Stay',
      bill: 'snf',
      reason: 'Skilled nursing Part A stay, not an emergency (consolidated billing)',
      when: condition(
        g,
        'snfStay',
        'A Skilled Nursing Stay on a Non-Emergency Trip',
        { facilityStay: stay, emergency: ['boolean', 'entry.emergency'] },
        [
          { field: 'facilityStay', op: 'is', value: 'snf' },
          { field: 'emergency', op: 'is', value: false }
        ]
      )
    }
  ];
  const billed = firstOf(
    g,
    'billed',
    'Billed To',
    'string',
    rules.map((r) => ({
      id: `${r.id}Bill`,
      label: `${r.label} Billing`,
      when: r.when,
      value: fixed(r.bill)
    })),
    fixed('payer')
  );
  const toPayers = condition(
    g,
    'toPayers',
    'Billed to the Payers',
    { billed: ['string', billed] },
    [{ field: 'billed', op: 'is', value: 'payer' }]
  );
  const party = select(
    g,
    'party',
    'Payer, Else Facility',
    toPayers,
    fixed('payer'),
    fixed('facility')
  );
  const reasons = reasonsOf(
    g,
    'reasons',
    'Rules That Held',
    rules.map((r) => ({
      id: `${r.id}Reason`,
      label: `${r.label} Reason`,
      when: r.when,
      reason: r.reason
    }))
  );
  g.add('facility', 'billing.responsible-facility', { label: 'Responsible Facility' });
  g.ret('return');
  g.wire('entry.pickupFacility', 'pickup.facility', 'facility.pickupFacility');
  g.wire('entry.destinationFacility', 'destination.facility', 'facility.destinationFacility');
  g.wire(billed, 'facility.bill');
  g.wire(party, 'return.party');
  g.wire('facility.facilityId', 'return.facilityId');
  g.wire('facility.facilityName', 'return.facilityName');
  g.wire(reasons, 'return.reasons');
  return g.def;
};

const responsibleFacility = (): GraphDef => {
  const g = rule(
    [
      d(
        'bill',
        'string',
        'Facility Billed',
        'Which facility the Facility Responsibility rule bills: contract, pickup or snf; anything else names none.',
        true
      ),
      PICKUP_IN,
      DESTINATION_IN
    ],
    [FACILITY_ID_OUT, FACILITY_NAME_OUT]
  );
  g.add('pickup', 'billing.facility.break', { label: 'Pickup Facility' });
  g.add('destination', 'billing.facility.break', { label: 'Destination Facility' });
  const billing = (
    id: string,
    label: string,
    kind: string,
    also?: [field: string, type: ValueType, from: Port, value: Json]
  ) =>
    condition(
      g,
      id,
      label,
      { bill: ['string', 'entry.bill'], ...(also ? { [also[0]]: [also[1], also[2]] } : {}) },
      [
        { field: 'bill', op: 'is', value: kind },
        ...(also ? [{ field: also[0], op: 'is', value: also[3] }] : [])
      ]
    );
  const facility = firstOf(
    g,
    'facility',
    'Facility Billed',
    T.facility,
    [
      {
        id: 'contractPickup',
        label: 'Pickup Under Contract',
        when: billing('billContractPickup', 'Contract Facility at the Pickup', 'contract', [
          'pickupContract',
          'boolean',
          'pickup.contract',
          true
        ]),
        value: 'entry.pickupFacility'
      },
      {
        id: 'contractDestination',
        label: 'Destination Under Contract',
        when: billing('billContract', 'A Contract Facility', 'contract'),
        value: 'entry.destinationFacility'
      },
      {
        id: 'inpatientPickup',
        label: 'Inpatient Hospital at the Pickup',
        when: billing('billPickup', 'The Pickup Hospital', 'pickup'),
        value: 'entry.pickupFacility'
      },
      {
        id: 'snfPickup',
        label: 'Skilled Nursing at the Pickup',
        when: billing('billSnfPickup', 'Skilled Nursing Facility at the Pickup', 'snf', [
          'pickupKind',
          'string',
          'pickup.kind',
          'snf'
        ]),
        value: 'entry.pickupFacility'
      },
      {
        id: 'snfDestination',
        label: 'Skilled Nursing at the Destination',
        when: billing('billSnfDestination', 'Skilled Nursing Facility at the Destination', 'snf', [
          'destinationKind',
          'string',
          'destination.kind',
          'snf'
        ]),
        value: 'entry.destinationFacility'
      },
      {
        id: 'snfNeither',
        label: 'Skilled Nursing, Neither End Listed',
        when: billing('billSnf', 'A Skilled Nursing Stay', 'snf'),
        value: 'entry.pickupFacility'
      }
    ],
    fixed(null)
  );
  g.add('chosen', 'billing.facility.break', { label: 'Its ID and Name' });
  g.ret('return');
  g.wire('entry.pickupFacility', 'pickup.facility');
  g.wire('entry.destinationFacility', 'destination.facility');
  g.wire(facility, 'chosen.facility');
  g.wire('chosen.id', 'return.facilityId');
  g.wire('chosen.name', 'return.facilityName');
  return g.def;
};

const decideResponsibility = (): GraphDef => {
  const g = stage(
    [P.claimId()],
    [
      FACILITY_ID_OUT,
      d('reason', 'string', 'Reason', 'Why the facility is responsible, for the biller.', true)
    ],
    {
      payers: exit('Payers', 'The claim is billed to its payers.'),
      facility: exit('Facility', 'The claim is billed to a facility instead of its payers.')
    }
  );
  g.add('read', 'billing.read-claim', { label: 'Read Claim' });
  g.add('checkFacts', 'billing.claim-check-facts', { label: 'Claim Check Facts' });
  g.add('facts', 'billing.check-facts.break', { label: 'Check Facts' });
  g.add('rule', 'billing.facility-responsibility', { label: 'Facility Responsibility' });
  g.add('reason', 'std.list.first', { label: 'Main Reason' });
  g.add('route', 'std.flow.switch', { label: 'Billed To?', config: { cases: ['facility'] } });
  g.ret('payersDone', 'payers');
  g.ret('facilityDone', 'facility');
  g.wire('entry.exec', 'read.exec');
  g.wire('entry.claimId', 'read.claimId');
  g.wire('read.then', 'route.exec');
  g.wire('read.record', 'checkFacts.record');
  g.wire('checkFacts.facts', 'facts.facts');
  for (const pin of [
    'recordedParty',
    'facilityStay',
    'emergency',
    'pickupFacility',
    'destinationFacility'
  ]) {
    g.wire(`facts.${pin}`, `rule.${pin}`);
  }
  g.wire('rule.party', 'route.value');
  g.wire('rule.reasons', 'reason.list');
  g.wire('route.default', 'payersDone.exec');
  g.wire('route.facility', 'facilityDone.exec');
  g.wire('rule.facilityId', 'facilityDone.facilityId');
  g.wire('reason.item', 'facilityDone.reason');
  return g.def;
};

const billFacility = (): GraphDef => {
  const g = stage(
    [
      P.claimId(),
      d('facilityId', { id: 'facility' }, 'Facility', 'The facility the rule names, if any.', true),
      d('reason', 'string', 'Reason', 'Why the facility is responsible.', true),
      P.subject(),
      P.context()
    ],
    [],
    {
      billed: exit('Billed to Facility', 'The claim is billed to the facility it names.'),
      payers: exit('Bill Payers', 'A biller chose to bill the payers instead.'),
      voided: exit('Voided', 'A biller voided the claim.')
    }
  );
  g.add('choices', 'billing.facility-choices', { label: 'Facility Choices' });
  const defaults = makeObject(g, 'defaults', 'Suggested Facility', {
    facilityId: [{ id: 'facility' }, 'entry.facilityId']
  });
  const context = makeObject(g, 'context', 'Task Details', {
    reason: ['string', 'entry.reason'],
    claim: ['any', 'entry.context']
  });
  g.add('task', 'std.human.task', {
    label: 'Bill Facility',
    config: {
      title: 'Bill facility',
      queue: 'billing-review',
      instructions:
        'This transport looks like the responsibility of a facility, not of the patient’s payers; the reason says why. Choose the facility responsible and bill it: the claim then waits for the facility invoice instead of going to payers on an 837P. Bill the payers when the facility is not responsible, or void the claim if it should never be billed.',
      fields: [
        {
          name: 'facilityId',
          type: { id: 'facility' },
          label: 'Responsible facility',
          required: ['billFacility']
        },
        { name: 'note', type: 'string', label: 'Note' }
      ],
      outcomes: ['billFacility', 'billPayers', 'void'],
      hints: {
        billFacility:
          'Bills the facility; the claim waits for its monthly invoice instead of going to payers.',
        billPayers:
          'Records that the facility is not responsible; the claim goes on to its payers.',
        void: 'Voids the claim so it is never billed.'
      },
      prefill: 'suggested'
    }
  });
  g.add('facility', 'std.logic.coalesce', { label: 'Chosen, Else Suggested' });
  g.add('billedNote', 'std.logic.coalesce', { label: 'Note, Else the Reason' });
  g.add('confirm', 'billing.record-responsibility', {
    label: 'Bill the Facility',
    values: { party: 'facility' }
  });
  const payersNote = orElse(
    g,
    'payersNote',
    'Note, Else Billed the Payers Instead',
    'task.note',
    fixed('A biller billed the payers instead of the facility')
  );
  g.add('payers', 'billing.record-responsibility', {
    label: 'Bill the Payers Instead',
    values: { party: 'payer' }
  });
  g.ret('billedDone', 'billed');
  g.ret('payersDone', 'payers');
  g.ret('voidedDone', 'voided');
  g.wire('entry.claimId', 'confirm.claimId', 'payers.claimId');
  g.wire('entry.facilityId', 'facility.fallback');
  g.wire('entry.reason', 'billedNote.fallback');
  g.wire('entry.subject', 'task.subject');
  g.wire('entry.exec', 'choices.exec');
  g.wire('choices.then', 'task.exec');
  g.wire('choices.options', 'task.options');
  g.wire(defaults, 'task.defaults');
  g.wire(context, 'task.context');
  summary(
    g,
    'task',
    'This trip looks billable to a facility, not to the payers[ ({reason})]; choose the facility to bill, or bill the payers',
    { reason: 'entry.reason' }
  );
  g.wire('task.facilityId', 'facility.value');
  g.wire('task.note', 'billedNote.value');
  g.wire('task.billFacility', 'confirm.exec');
  g.wire('facility.result', 'confirm.facilityId');
  g.wire('billedNote.result', 'confirm.note');
  g.wire('confirm.then', 'billedDone.exec');
  g.wire('task.billPayers', 'payers.exec');
  g.wire(payersNote, 'payers.note');
  g.wire('payers.then', 'payersDone.exec');
  g.wire('task.void', 'voidedDone.exec');
  return g.def;
};

export const facilityGraphs: SeedGraph[] = [
  asRule(
    'billing.facility-responsibility',
    'Facility Responsibility',
    'Decides whether a transport is billed to a facility instead of the payers: a contract facility at the pickup or destination, a hospital inpatient who stays admitted, or a skilled nursing Part A stay on a non-emergency trip, unless a biller already chose. Names the facility with the Responsible Facility rule.',
    facilityResponsibility()
  ),
  asRule(
    'billing.responsible-facility',
    'Responsible Facility',
    'Names the directory facility the claim is billed to, at the end of the trip that facility is at: the contract facility (the pickup when both are), the pickup hospital for an inpatient, or the skilled nursing facility (the pickup unless only the destination is one).',
    responsibleFacility()
  ),
  asStage(
    'billing.decide-responsibility',
    'Decide Responsibility',
    'Reads the saved claim and runs Facility Responsibility on it: goes on through Facility with the facility and why when a facility is billed, else through Payers.',
    decideResponsibility()
  ),
  asStage(
    'billing.bill-facility',
    'Bill Facility',
    'Asks a biller to confirm the facility a transport is billed to (Bill facility task). Billing it sets the responsible facility on the claim, so its payer cycle waits for the facility invoice instead of sending an 837P; the biller can also bill the payers instead, or void.',
    billFacility()
  )
];
