import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  asRule,
  asStage,
  d,
  exit,
  expr,
  field,
  is,
  named,
  P,
  rule,
  shared,
  stage,
  summarize,
  T,
  table
} from './shared.ts';

const BILL_FACILITY_SUMMARY = `'This trip looks billable to a facility, not to the payers' +
  (${named('reason', 'null')} != null ? ' (' + reason + ')' : '') +
  '; choose the facility to bill, or bill the payers'`;

const FACILITY_IN = (name: string, label: string, description: string) =>
  d(name, T.facility, label, description, true);

const PARTY_OUT = d('party', 'string', 'Responsible Party', 'payer or facility.');

const FACILITY_ID_OUT = d(
  'facilityId',
  'string',
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

const RESPONSIBLE_FACILITY = `bill == 'contract'
  ? (pickup != null && pickup.contract == true ? pickup : destination)
  : bill == 'pickup'
    ? pickup
    : bill == 'snf'
      ? (pickup != null && pickup.kind == 'snf' ? pickup : destination != null && destination.kind == 'snf' ? destination : pickup)
      : null`;

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
  g.add(
    'contract',
    'std.expr',
    expr(
      'Either End Under Contract',
      '(pickup != null && pickup.contract == true) || (destination != null && destination.contract == true)'
    )
  );
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
  g.add('facility', 'std.expr', expr('Facility Billed', RESPONSIBLE_FACILITY));
  g.add(
    'chosen',
    'std.expr',
    expr(
      'Its ID and Name',
      '{ id: facility == null ? null : facility.id, name: facility == null ? null : facility.name }'
    )
  );
  g.add('id', 'std.object.get', { label: 'Facility ID', values: { path: 'id' } });
  g.add('name', 'std.object.get', { label: 'Facility Name', values: { path: 'name' } });
  g.ret('return');
  g.wire('entry.pickupFacility', 'contract.pickup', 'facility.pickup');
  g.wire('entry.destinationFacility', 'contract.destination', 'facility.destination');
  g.wire('entry.recordedParty', 'decide.recordedParty');
  g.wire('entry.facilityStay', 'decide.facilityStay');
  g.wire('entry.emergency', 'decide.emergency');
  g.wire('contract.result', 'decide.contract');
  g.wire('decide.bill', 'facility.bill');
  g.wire('facility.result', 'chosen.facility');
  g.wire('chosen.result', 'id.object', 'name.object');
  g.wire('decide.party', 'return.party');
  g.wire('id.value', 'return.facilityId');
  g.wire('name.value', 'return.facilityName');
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
      d('facilityId', 'string', 'Facility', 'The facility the rule names, if any.', true),
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
  g.add('defaults', 'std.expr', expr('Suggested Facility', '{ facilityId: facilityId }'));
  g.add('context', 'std.expr', expr('Facility Context', '{ reason: reason, claim: context }'));
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
          type: 'string',
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
  g.wire('entry.context', 'context.context');
  g.wire('entry.subject', 'task.subject');
  g.wire('entry.exec', 'choices.exec');
  g.wire('choices.then', 'task.exec');
  g.wire('choices.options', 'task.options');
  g.wire('defaults.result', 'task.defaults');
  g.wire('context.result', 'task.context');
  summarize(g, 'task', BILL_FACILITY_SUMMARY, { reason: 'entry.reason' });
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
