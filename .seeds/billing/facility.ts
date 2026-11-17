import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  asRule,
  asStage,
  d,
  exit,
  field,
  is,
  P,
  rule,
  shared,
  stage,
  summary,
  T,
  table
} from './shared.ts';

const FACILITY_IN = (name: string, label: string, description: string) =>
  d(name, T.facility, label, description, true);

const PARTY_OUT = d('party', 'string', 'Responsible Party', 'payer or facility.');

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

const facilityBilled = () =>
  shared.decision(
    'billing.facility-billed',
    'Facility Billed',
    'Names which end of the trip the responsible facility is at, for the facility a Facility Responsibility rule bills: the contract facility (the pickup when both are), the pickup hospital for an inpatient, or the skilled nursing facility (the pickup unless only the destination is one).',
    table(
      [
        field('bill', 'string', 'Facility billed (contract, pickup or snf)'),
        field('pickupContract', 'boolean', 'The pickup facility is under contract'),
        field('pickupKind', 'string', 'Kind of the pickup facility'),
        field('destinationKind', 'string', 'Kind of the destination facility')
      ],
      [field('end', 'string', 'Facility at (pickup or destination)')],
      [
        {
          label: 'Contract facility at the pickup',
          when: { bill: is('contract'), pickupContract: is(true) },
          set: { end: 'pickup' }
        },
        {
          label: 'Contract facility at the destination',
          when: { bill: is('contract') },
          set: { end: 'destination' }
        },
        {
          label: 'Hospital the inpatient was picked up from',
          when: { bill: is('pickup') },
          set: { end: 'pickup' }
        },
        {
          label: 'Skilled nursing facility at the pickup',
          when: { bill: is('snf'), pickupKind: is('snf') },
          set: { end: 'pickup' }
        },
        {
          label: 'Skilled nursing facility at the destination',
          when: { bill: is('snf'), destinationKind: is('snf') },
          set: { end: 'destination' }
        },
        {
          label: 'Skilled nursing stay, neither end listed as one',
          when: { bill: is('snf') },
          set: { end: 'pickup' }
        }
      ],
      {},
      'No facility is billed'
    )
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
        'The stay a biller confirmed: none, inpatient (Part A) or snf (Part A).',
        true
      ),
      d('emergency', 'boolean', 'Emergency', 'Whether the trip is billed as an emergency.', true),
      FACILITY_IN('pickupFacility', 'Pickup Facility', 'The directory facility at the pickup.'),
      FACILITY_IN(
        'destinationFacility',
        'Destination Facility',
        'The directory facility at the destination.'
      )
    ],
    [PARTY_OUT, FACILITY_ID_OUT, FACILITY_NAME_OUT, P.reasons('the claim is billed to its payer')]
  );
  g.add('pickup', 'billing.facility.break', { label: 'Pickup Facility' });
  g.add('destination', 'billing.facility.break', { label: 'Destination Facility' });
  g.add('contract', 'std.logic.condition', {
    label: 'Either End Under Contract',
    config: {
      match: 'any',
      inputs: [
        { name: 'pickupContract', type: 'boolean', label: 'Pickup Under Contract' },
        { name: 'destinationContract', type: 'boolean', label: 'Destination Under Contract' }
      ],
      rules: [
        { field: 'pickupContract', op: 'is', value: true },
        { field: 'destinationContract', op: 'is', value: true }
      ]
    }
  });
  g.add('decide', 'std.table.decide', {
    label: 'Facility Responsibility',
    config: shared.decision(
      'billing.facility-responsibility',
      'Facility Responsibility',
      'Decides whether a transport is billed to a facility instead of the payers: a contract facility at either end, a hospital inpatient who stays admitted, or a skilled nursing Part A stay (consolidated billing) for a non-emergency trip. Bill names the facility: contract, pickup or snf.',
      table(
        [
          field('recordedParty', 'string', 'Already recorded as billed to'),
          field('contract', 'boolean', 'Contract facility at either end'),
          field('facilityStay', 'string', 'Facility stay a biller confirmed'),
          field('emergency', 'boolean', 'Emergency')
        ],
        [
          field('party', 'string', 'Billed to (payer or facility)'),
          field('bill', 'string', 'Facility billed (contract, pickup or snf)')
        ],
        [
          {
            label: 'A biller chose to bill the payers',
            when: { recordedParty: is('payer') },
            set: { party: 'payer' }
          },
          {
            label: 'Already billed to the facility',
            when: { recordedParty: is('facility') },
            set: { party: 'facility', bill: 'recorded' }
          },
          {
            label: 'Transport to or from a contract facility',
            when: { contract: is(true) },
            set: { party: 'facility', bill: 'contract' }
          },
          {
            label: 'Hospital inpatient who stays admitted (Part A)',
            when: { facilityStay: is('inpatient') },
            set: { party: 'facility', bill: 'pickup' }
          },
          {
            label: 'Skilled nursing Part A stay, not an emergency (consolidated billing)',
            when: { facilityStay: is('snf'), emergency: is(false) },
            set: { party: 'facility', bill: 'snf' }
          }
        ],
        { party: 'payer' }
      )
    )
  });
  g.add('end', 'std.table.decide', { label: 'Facility Billed', config: facilityBilled() });
  g.add('facility', 'std.logic.choose', {
    label: 'Facility at That End',
    config: {
      mode: 'byCase',
      type: T.facility,
      cases: [{ when: 'pickup' }, { when: 'destination' }]
    }
  });
  g.add('chosen', 'billing.facility.break', { label: 'Its ID and Name' });
  g.ret('return');
  g.wire('entry.pickupFacility', 'pickup.facility', 'facility.case1');
  g.wire('entry.destinationFacility', 'destination.facility', 'facility.case2');
  g.wire('pickup.contract', 'contract.pickupContract', 'end.pickupContract');
  g.wire('destination.contract', 'contract.destinationContract');
  g.wire('pickup.kind', 'end.pickupKind');
  g.wire('destination.kind', 'end.destinationKind');
  g.wire('entry.recordedParty', 'decide.recordedParty');
  g.wire('entry.facilityStay', 'decide.facilityStay');
  g.wire('entry.emergency', 'decide.emergency');
  g.wire('contract.result', 'decide.contract');
  g.wire('decide.bill', 'end.bill');
  g.wire('end.end', 'facility.key');
  g.wire('facility.value', 'chosen.facility');
  g.wire('decide.party', 'return.party');
  g.wire('chosen.id', 'return.facilityId');
  g.wire('chosen.name', 'return.facilityName');
  g.wire('decide.rules', 'return.reasons');
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
  g.add('read', 'billing.read-claim-checks', { label: 'Read Claim for Checks' });
  g.add('facts', 'billing.check-facts.break');
  g.add('rule', 'billing.facility-responsibility', { label: 'Facility Responsibility' });
  g.add('reason', 'std.list.first', { label: 'Main Reason' });
  g.add('route', 'std.flow.switch', { label: 'Billed To?', config: { cases: ['facility'] } });
  g.ret('payersDone', 'payers');
  g.ret('facilityDone', 'facility');
  g.wire('entry.exec', 'read.exec');
  g.wire('entry.claimId', 'read.claimId');
  g.wire('read.then', 'route.exec');
  g.wire('read.facts', 'facts.facts');
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
  g.add('defaults', 'std.object.make', {
    label: 'Suggested Facility',
    config: { fields: [{ name: 'facilityId', type: { id: 'facility' } }] }
  });
  g.add('context', 'std.object.make', {
    label: 'Facility Context',
    config: {
      fields: [
        { name: 'reason', type: 'string' },
        { name: 'claim', type: 'any' }
      ]
    }
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
  g.add('payersNote', 'std.logic.coalesce', {
    label: 'Note, Else Why',
    values: { fallback: 'A biller billed the payers instead of the facility' }
  });
  g.add('payers', 'billing.record-responsibility', {
    label: 'Bill the Payers Instead',
    values: { party: 'payer' }
  });
  g.ret('billedDone', 'billed');
  g.ret('payersDone', 'payers');
  g.ret('voidedDone', 'voided');
  g.wire('entry.claimId', 'confirm.claimId', 'payers.claimId');
  g.wire('entry.facilityId', 'defaults.facilityId', 'facility.fallback');
  g.wire('entry.reason', 'context.reason', 'billedNote.fallback');
  g.wire('entry.context', 'context.claim');
  g.wire('entry.subject', 'task.subject');
  g.wire('entry.exec', 'choices.exec');
  g.wire('choices.then', 'task.exec');
  g.wire('choices.options', 'task.options');
  g.wire('defaults.object', 'task.defaults');
  g.wire('context.object', 'task.context');
  summary(
    g,
    'task',
    'This trip looks billable to a facility, not to the payers[ ({reason})]; choose the facility to bill, or bill the payers',
    { reason: 'entry.reason' }
  );
  g.wire('task.facilityId', 'facility.value');
  g.wire('task.note', 'billedNote.value', 'payersNote.value');
  g.wire('task.billFacility', 'confirm.exec');
  g.wire('facility.result', 'confirm.facilityId');
  g.wire('billedNote.result', 'confirm.note');
  g.wire('confirm.then', 'billedDone.exec');
  g.wire('task.billPayers', 'payers.exec');
  g.wire('payersNote.result', 'payers.note');
  g.wire('payers.then', 'payersDone.exec');
  g.wire('task.void', 'voidedDone.exec');
  return g.def;
};

export const facilityGraphs: SeedGraph[] = [
  asRule(
    'billing.facility-responsibility',
    'Facility Responsibility',
    'Decides whether a transport is billed to a facility instead of the payers (Facility Responsibility table): a contract facility at the pickup or destination, a hospital inpatient who stays admitted, or a skilled nursing Part A stay on a non-emergency trip, unless a biller already chose; names the facility from the directory.',
    facilityResponsibility()
  ),
  asStage(
    'billing.decide-responsibility',
    'Decide Responsibility',
    'Reads the saved claim and runs Facility Responsibility on it. Continues through facility with the facility and why, else through payers.',
    decideResponsibility()
  ),
  asStage(
    'billing.bill-facility',
    'Bill Facility',
    'Asks a biller to confirm the facility a transport is billed to (Bill facility task): billing it sets the claim responsible facility, so its payer cycle waits for the facility invoice instead of sending an 837P; or bill the payers instead, or void.',
    billFacility()
  )
];
