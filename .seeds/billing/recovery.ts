import { CLAIM_FIX_FIELDS, CLAIM_SIGNAL } from '@ugula/billing';
import type { GraphDef, Json, ValueType } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import { graph, p } from './glossary.ts';
import {
  asRule,
  asStage,
  asWorkflow,
  atLeast,
  atMost,
  type Builder,
  d,
  exit,
  field,
  is,
  oneOf,
  P,
  rule,
  shared,
  summary,
  T,
  table,
  template
} from './shared.ts';

const DAY_MS = 86_400_000;

const MEDICARE = ['MA', 'MB'];

const SUGGESTIONS: Record<string, string> = {
  correctClaim: 'correcting it is suggested',
  appeal: 'an appeal is suggested',
  billAnotherPayer: 'billing another payer is suggested',
  moveToPatient: 'moving the balance to the patient is suggested',
  writeOff: 'writing it off is suggested'
};

const recordEvent = (
  g: Builder,
  id: string,
  kind: string,
  label: string,
  fixed: Record<string, Json> = {}
) => g.add(id, 'billing.record-claim-event', { label, values: { kind, ...fixed } });

const orElse = (
  g: Builder,
  id: string,
  label: string,
  fallback: Json,
  type: ValueType = 'string'
) =>
  g.add(id, 'std.logic.choose', {
    label,
    config: { mode: 'first', type, count: 2 },
    values: { option2: fallback }
  });

const above = (g: Builder, id: string, label: string, name: string, value: number) =>
  g.add(id, 'std.logic.condition', {
    label,
    config: {
      inputs: [{ name, type: 'integer' }],
      rules: [{ field: name, op: 'gt', value }]
    }
  });

const taskDetails = (
  g: Builder,
  label: string,
  addedLabel: string,
  fields: { name: string; type: ValueType }[]
) => {
  g.add('claimDetails', 'std.logic.coalesce', {
    label: 'Claim Details, Else None',
    values: { fallback: {} }
  });
  g.add('added', 'std.object.make', { label: addedLabel, config: { fields } });
  g.add('details', 'std.object.merge', { label });
  g.wire('entry.context', 'claimDetails.value');
  g.wire('claimDetails.result', 'details.a');
  g.wire('added.object', 'details.b');
};

const DENIAL_IN = d(
  'denial',
  T.denial,
  'Denial Facts',
  'The denial: payer, how it was routed, reason codes, remittance date, appeals so far and payer settings.'
);

const COVERAGE = d(
  'coverageId',
  { id: 'coverage' },
  'Payer',
  'The payer on the claim whose denial is worked.'
);

const DONE = exit('Done', 'The denial was worked; the claim cycle decides what comes next.');

const VOID = exit('Void', 'A biller voided the claim.');

const WRITE_OFF = exit('Write Off', 'A biller chose to write off the balance.');

const claimInputs = [
  p('claimId', { id: 'claim' }),
  COVERAGE,
  p('subject', 'string', true),
  p('context', 'any', true)
];

const code = (group: string, ...reasons: string[]) => reasons.map((r) => `${group}-${r}`);

const denialCategory = (): GraphDef => {
  const g = rule(
    [DENIAL_IN],
    [
      d(
        'suggestion',
        'string',
        'Suggested Decision',
        'What the denial most likely needs: correctClaim, appeal, billAnotherPayer, moveToPatient or writeOff.'
      ),
      P.reasons('this decision is suggested')
    ]
  );
  g.add('denial', 'billing.denial-facts.break');
  g.add('decide', 'std.table.decide', {
    label: 'Denial Categories',
    config: shared.decision(
      'billing.denial-categories',
      'Denial Categories',
      'Suggests what a denial needs from how Remittance Routing routed it and its group and reason codes (CARC), top to bottom; the biller decides in the Denial Decision task.',
      table(
        [
          field('route', 'string', 'How the remittance was routed: denial, appeal or fix'),
          field('codes', { list: 'string' }, 'Group and reason codes (CO-50)'),
          field('payerKind', 'string', 'Claim filing indicator of the payer')
        ],
        [field('suggestion', 'string', 'Suggested decision')],
        [
          {
            label: 'Remittance Routing found claim data to fix',
            when: { route: is('fix') },
            set: { suggestion: 'correctClaim' }
          },
          {
            label: 'Missing, invalid or duplicate claim data (CARC 4, 11, 16, 18, 146, 181, 182)',
            when: { codes: oneOf(...code('CO', '4', '11', '16', '18', '146', '181', '182')) },
            set: { suggestion: 'correctClaim' }
          },
          {
            label: 'Another payer is responsible (CARC 22, 23, 24, 109)',
            when: {
              codes: oneOf(...code('CO', '22', '23', '24', '109'), ...code('OA', '22', '23', '109'))
            },
            set: { suggestion: 'billAnotherPayer' }
          },
          {
            label:
              'Not covered on the date of service or the patient is responsible (26, 27, 31, 49, 96, 177, 204)',
            when: {
              codes: oneOf(...code('CO', '26', '27', '31', '177'), ...code('PR', '49', '96', '204'))
            },
            set: { suggestion: 'moveToPatient' }
          },
          {
            label: "Filed after the payer's limit (CARC 29)",
            when: { codes: oneOf('CO-29') },
            set: { suggestion: 'writeOff' }
          },
          {
            label: 'Remittance Routing sent it to appeal',
            when: { route: is('appeal') },
            set: { suggestion: 'appeal' }
          }
        ],
        { suggestion: 'appeal' },
        'No reason code points elsewhere, so an appeal is suggested'
      )
    )
  });
  g.ret('return');
  g.wire('entry.denial', 'denial.denial');
  for (const f of ['route', 'codes', 'payerKind']) g.wire(`denial.${f}`, `decide.${f}`);
  g.wire('decide.suggestion', 'return.suggestion');
  g.wire('decide.reasons', 'return.reasons');
  return g.def;
};

const correctionMethod = (): GraphDef => {
  const g = rule(
    [
      DENIAL_IN,
      d(
        'correction',
        'string',
        'Correction',
        'replace to correct the claim, or void to cancel it.',
        true
      ),
      d(
        'payerClaimNumber',
        'string',
        'Payer Claim Number',
        'The payer claim number a biller entered for the claim being corrected, if any.',
        true
      )
    ],
    [
      d('method', 'string', 'Method', 'newClaim, replacement, void or reopening.'),
      d(
        'frequency',
        'string',
        'Frequency',
        'The claim frequency the correction is filed with: 1 new claim, 7 replacement, 8 void.',
        true
      ),
      P.reasons('the claim is corrected this way')
    ]
  );
  g.add('denial', 'billing.denial-facts.break');
  g.add('number', 'std.logic.coalesce', { label: 'Claim Number Entered, Else Denied' });
  g.add('noNumber', 'std.logic.is-null', { label: 'No Payer Claim Number' });
  g.add('adjudicated', 'std.logic.not', { label: 'Adjudicated by the Payer' });
  g.add('decide', 'std.table.decide', {
    label: 'Correction Methods',
    config: shared.decision(
      'billing.correction-methods',
      'Correction Methods',
      "How a claim the payer has is corrected, from a denial, a reconcile or a follow-up, by whether the payer adjudicated it, the payer's correction setting in the payer directory, its kind, the denial's reason and remark codes and what the biller asked for: a new claim (frequency 1) for a claim returned as unprocessable, which has no determination to reopen or appeal, a replacement (frequency 7), a void (frequency 8) or, where the payer takes no corrected claims, a reopening request.",
      table(
        [
          field('adjudicated', 'boolean', 'The payer adjudicated the claim (835)'),
          field('correctionMethod', 'string', 'Payer setting: replacement or reopening'),
          field('payerKind', 'string', 'Claim filing indicator of the payer'),
          field('correction', 'string', 'What the biller asked for: replace or void'),
          field('route', 'string', 'How Remittance Routing routed the denial'),
          field('codes', { list: 'string' }, 'Group and reason codes (CO-16)'),
          field('remarks', { list: 'string' }, 'Remark codes (MA130)')
        ],
        [field('method', 'string', 'Method'), field('frequency', 'string', 'Claim frequency')],
        [
          {
            label: 'The payer never adjudicated the claim: submit it again as a new claim',
            when: { adjudicated: is(false) },
            set: { method: 'newClaim', frequency: '1' }
          },
          {
            label: 'Returned as unprocessable (MA130): submit a new claim',
            when: { route: is('fix'), remarks: oneOf('MA130') },
            set: { method: 'newClaim', frequency: '1' }
          },
          {
            label: 'Medicare could not process the claim (CO-16): submit a new claim',
            when: { route: is('fix'), codes: oneOf('CO-16'), payerKind: oneOf(...MEDICARE) },
            set: { method: 'newClaim', frequency: '1' }
          },
          {
            label: 'The payer takes reopening requests, not corrected claims',
            when: { correctionMethod: is('reopening') },
            set: { method: 'reopening', frequency: null }
          },
          {
            label: 'Void the claim the payer has on file (frequency 8)',
            when: { correctionMethod: is('replacement'), correction: is('void') },
            set: { method: 'void', frequency: '8' }
          },
          {
            label: 'The payer takes replacement claims (frequency 7)',
            when: { correctionMethod: is('replacement') },
            set: { method: 'replacement', frequency: '7' }
          },
          {
            label: 'Medicare corrects processed claims through reopenings (verify with the MAC)',
            when: { payerKind: oneOf(...MEDICARE) },
            set: { method: 'reopening', frequency: null }
          },
          {
            label: 'Void the claim the payer has on file (frequency 8)',
            when: { correction: is('void') },
            set: { method: 'void', frequency: '8' }
          }
        ],
        { method: 'replacement', frequency: '7' },
        'Replace the claim the payer has on file (frequency 7)'
      )
    )
  });
  g.ret('return');
  g.wire('entry.denial', 'denial.denial');
  g.wire('entry.payerClaimNumber', 'number.value');
  g.wire('denial.payerClaimNumber', 'number.fallback');
  g.wire('number.result', 'noNumber.value');
  g.wire('noNumber.result', 'adjudicated.value');
  g.wire('adjudicated.result', 'decide.adjudicated');
  g.wire('denial.correctionMethod', 'decide.correctionMethod');
  g.wire('denial.payerKind', 'decide.payerKind');
  g.wire('denial.route', 'decide.route');
  g.wire('denial.codes', 'decide.codes');
  g.wire('denial.remarks', 'decide.remarks');
  g.wire('entry.correction', 'decide.correction');
  g.wire('decide.method', 'return.method');
  g.wire('decide.frequency', 'return.frequency');
  g.wire('decide.reasons', 'return.reasons');
  return g.def;
};

const appealLevel = (): GraphDef => {
  const g = rule(
    [DENIAL_IN],
    [
      d('level', 'string', 'Level', 'redetermination, reconsideration, hearing or appeal.'),
      d('levelName', 'string', 'Level Name', 'The appeal level as the packet and tasks name it.'),
      d('dueOn', 'string', 'Due On', 'The last day to send the appeal (YYYY-MM-DD).'),
      d(
        'decisionWaitMs',
        'integer',
        'Decision Wait Milliseconds',
        'How long to wait for the decision before asking a biller.'
      ),
      P.reasons('the appeal is at this level and due then')
    ]
  );
  g.add('denial', 'billing.denial-facts.break');
  const level = (
    label: string,
    when: Record<string, ReturnType<typeof is>>,
    set: [string, string, number, number]
  ) => ({
    label,
    when,
    set: { level: set[0], levelName: set[1], days: set[2], decisionDays: set[3] }
  });
  g.add('decide', 'std.table.decide', {
    label: 'Appeal Levels',
    config: shared.decision(
      'billing.appeal-levels',
      'Appeal Levels',
      'The next appeal level of a denial and the days allowed to file it from the remittance, by the kind of payer and the appeals already sent. A payer directory appeal limit replaces the days for other payers. Medicare limits: redetermination 120 days, reconsideration 180 days (42 CFR 405.942 and 405.962); the rest are defaults to verify.',
      table(
        [
          field('payerKind', 'string', 'Claim filing indicator of the payer'),
          field('appeals', 'integer', 'Appeals already sent')
        ],
        [
          field('level', 'string', 'Level'),
          field('levelName', 'string', 'Level name'),
          field('days', 'integer', 'Days to file from the remittance'),
          field('decisionDays', 'integer', 'Days to wait for the decision')
        ],
        [
          level(
            'Medicare: redetermination by the MAC within 120 days',
            { payerKind: oneOf(...MEDICARE), appeals: atMost(0) },
            ['redetermination', 'Redetermination', 120, 60]
          ),
          level(
            'Medicare: reconsideration by the QIC within 180 days',
            { payerKind: oneOf(...MEDICARE), appeals: atMost(1) },
            ['reconsideration', 'Reconsideration', 180, 60]
          ),
          level(
            'Medicare: hearing before an ALJ within 60 days (verify)',
            { payerKind: oneOf(...MEDICARE), appeals: atLeast(2) },
            ['hearing', 'ALJ Hearing', 60, 90]
          ),
          level(
            'Medicaid: appeal within 90 days (verify with the state)',
            { payerKind: oneOf('MC'), appeals: atMost(0) },
            ['appeal', 'Medicaid Appeal', 90, 90]
          ),
          level('First appeal to the payer within 180 days (verify)', { appeals: atMost(0) }, [
            'appeal',
            'First Level Appeal',
            180,
            30
          ])
        ],
        { level: 'appeal', levelName: 'Second Level Appeal', days: 60, decisionDays: 30 },
        'Second appeal to the payer within 60 days (verify)'
      )
    )
  });
  g.add('medicare', 'std.logic.condition', {
    label: 'Medicare',
    config: {
      inputs: [{ name: 'payerKind', type: 'string' }],
      rules: [{ field: 'payerKind', op: 'oneOf', value: MEDICARE }]
    }
  });
  g.add('directoryDays', 'std.logic.coalesce', { label: 'Payer Directory Days, Else the Table' });
  g.add('days', 'std.logic.select', { label: 'Days Allowed' });
  g.add('dueOn', 'billing.due-after-days', { label: 'Due On' });
  g.add('wait', 'std.math.multiply', { label: 'Decision Wait', values: { b: DAY_MS } });
  g.add('byDirectory', 'std.logic.equal', { label: 'Days Are the Payer Directory Limit' });
  template(g, 'directoryText', 'Payer Directory Text', 'The payer directory allows {days} days');
  g.add('directoryReason', 'std.logic.select', { label: 'Payer Directory Reason' });
  g.add('directoryReasons', 'std.list.make', {
    label: 'Payer Directory Reasons',
    config: { count: 1, type: 'string' }
  });
  g.add('reasons', 'std.list.join', { label: 'Why', config: { count: 2, type: 'string' } });
  g.ret('return');
  g.wire('entry.denial', 'denial.denial');
  g.wire('denial.payerKind', 'decide.payerKind', 'medicare.payerKind');
  g.wire('denial.appeals', 'decide.appeals');
  g.wire('denial.appealDays', 'directoryDays.value', 'byDirectory.b', 'directoryText.days');
  g.wire('decide.days', 'directoryDays.fallback', 'days.whenTrue');
  g.wire('medicare.result', 'days.condition');
  g.wire('directoryDays.result', 'days.whenFalse');
  g.wire('days.result', 'dueOn.days', 'byDirectory.a');
  g.wire('denial.deniedOn', 'dueOn.from');
  g.wire('decide.decisionDays', 'wait.a');
  g.wire('byDirectory.result', 'directoryReason.condition');
  g.wire('directoryText.text', 'directoryReason.whenTrue');
  g.wire('directoryReason.result', 'directoryReasons.item1');
  g.wire('decide.reasons', 'reasons.list1');
  g.wire('directoryReasons.list', 'reasons.list2');
  g.wire('decide.level', 'return.level');
  g.wire('decide.levelName', 'return.levelName');
  g.wire('dueOn.dueOn', 'return.dueOn');
  g.wire('wait.result', 'return.decisionWaitMs');
  g.wire('reasons.list', 'return.reasons');
  return g.def;
};

const dueAfterDays = (): GraphDef => {
  const g = rule(
    [
      d(
        'from',
        'string',
        'From',
        'The day the days are counted from (YYYY-MM-DD); today when empty.',
        true
      ),
      d('days', 'integer', 'Days', 'How many days are allowed.')
    ],
    [d('dueOn', 'string', 'Due On', 'The last day (YYYY-MM-DD).')]
  );
  g.add('now', 'std.time.now', { label: 'Now' });
  g.add('start', 'std.logic.choose', {
    label: 'From, Else Today',
    config: { mode: 'first', type: 'datetime', count: 2 }
  });
  g.add('later', 'std.time.add', { label: 'Days Later', config: { unit: 'days' } });
  g.add('day', 'std.time.parts', { label: 'Due Day' });
  g.ret('return');
  g.wire('entry.from', 'start.option1');
  g.wire('now.now', 'start.option2');
  g.wire('start.value', 'later.time');
  g.wire('entry.days', 'later.amount');
  g.wire('later.time', 'day.time');
  g.wire('day.date', 'return.dueOn');
  return g.def;
};

const appealDecision = (): GraphDef => {
  const g = rule(
    [
      d('paidCents', 'integer', 'Paid', 'What the payer paid after the appeal (cents).'),
      d('balanceCents', 'integer', 'Balance', 'The balance left (cents).')
    ],
    [
      d('decision', 'string', 'Decision', 'overturned, partial or upheld.'),
      P.reasons('the appeal was decided this way')
    ]
  );
  above(g, 'paid', 'Paid Something', 'paidCents', 0);
  g.add('settled', 'std.logic.condition', {
    label: 'Nothing Owed',
    config: {
      inputs: [{ name: 'balanceCents', type: 'integer' }],
      rules: [{ field: 'balanceCents', op: 'lte', value: 0 }]
    }
  });
  g.add('decide', 'std.table.decide', {
    label: 'Appeal Decisions',
    config: shared.decision(
      'billing.appeal-decisions',
      'Appeal Decisions',
      'What the remittance a payer sent after an appeal means for it.',
      table(
        [
          field('paid', 'boolean', 'The payer paid after the appeal'),
          field('settled', 'boolean', 'Nothing is owed')
        ],
        [field('decision', 'string', 'Decision')],
        [
          {
            label: 'The payer paid the claim',
            when: { paid: is(true), settled: is(true) },
            set: { decision: 'overturned' }
          },
          {
            label: 'The payer paid part of the claim',
            when: { paid: is(true) },
            set: { decision: 'partial' }
          }
        ],
        { decision: 'upheld' },
        'The payer paid nothing after the appeal'
      )
    )
  });
  g.ret('return');
  g.wire('entry.paidCents', 'paid.paidCents');
  g.wire('entry.balanceCents', 'settled.balanceCents');
  g.wire('paid.result', 'decide.paid');
  g.wire('settled.result', 'decide.settled');
  g.wire('decide.decision', 'return.decision');
  g.wire('decide.reasons', 'return.reasons');
  return g.def;
};

const dueRule = (
  key: string,
  name: string,
  description: string,
  factsIn: ReturnType<typeof d>,
  breakNode: string,
  dateField: string,
  rows: { label: string; when: Record<string, ReturnType<typeof is>>; days: number }[],
  otherwise: number
) => {
  const g = rule(
    [factsIn],
    [
      d('dueOn', 'string', 'Due On', 'The last day to act (YYYY-MM-DD).'),
      P.reasons('it is due then')
    ]
  );
  g.add('facts', breakNode);
  g.add('decide', 'std.table.decide', {
    label: name,
    config: shared.decision(
      key,
      name,
      description,
      table(
        [field('payerKind', 'string', 'Claim filing indicator of the payer, or patient')],
        [field('days', 'integer', 'Days allowed')],
        rows.map((r) => ({ label: r.label, when: r.when, set: { days: r.days } })),
        { days: otherwise },
        `Due ${otherwise} days after it was found`
      )
    )
  });
  g.add('dueOn', 'billing.due-after-days', { label: 'Due On' });
  g.ret('return');
  g.wire(`entry.${factsIn.name}`, `facts.${factsIn.name}`);
  g.wire('facts.payerKind', 'decide.payerKind');
  g.wire(`facts.${dateField}`, 'dueOn.from');
  g.wire('decide.days', 'dueOn.days');
  g.wire('dueOn.dueOn', 'return.dueOn');
  g.wire('decide.reasons', 'return.reasons');
  return g.def;
};

const refundDue = () =>
  dueRule(
    'billing.refund-deadlines',
    'Refund Deadlines',
    'The days allowed to return a credit balance from the day it appeared, by who overpaid. Medicare and Medicaid overpayments are returned within 60 days of being identified (42 CFR 401.305; verify Medicaid by state).',
    d(
      'refund',
      T.refund,
      'Refund Facts',
      'The credit balance, who paid last and when it appeared.'
    ),
    'billing.refund-facts.break',
    'identifiedOn',
    [
      {
        label: 'Medicare and Medicaid overpayments are returned within 60 days',
        when: { payerKind: oneOf(...MEDICARE, 'MC') },
        days: 60
      },
      {
        label: 'Patient credit balances are refunded within 30 days',
        when: { payerKind: is('patient') },
        days: 30
      }
    ],
    60
  );

const recordsDue = (): GraphDef => {
  const g = rule(
    [
      d(
        'payerKind',
        'string',
        'Payer Kind',
        'Claim filing indicator of the payer asking, or patient.'
      ),
      d(
        'requestedDue',
        'string',
        'Requested Due Date',
        'The due date the request names, if any.',
        true
      )
    ],
    [
      d('dueOn', 'string', 'Due On', 'The last day to send the records (YYYY-MM-DD).'),
      P.reasons('the records are due then')
    ]
  );
  g.add('decide', 'std.table.decide', {
    label: 'Records Deadlines',
    config: shared.decision(
      'billing.records-deadlines',
      'Records Deadlines',
      'The days allowed to answer a records request (ADR) when it names no due date, by the kind of payer. Medicare ADRs allow 45 days (verify with the MAC); others are defaults.',
      table(
        [field('payerKind', 'string', 'Claim filing indicator of the payer')],
        [field('days', 'integer', 'Days allowed')],
        [
          {
            label: 'Medicare additional documentation requests allow 45 days (verify)',
            when: { payerKind: oneOf(...MEDICARE) },
            set: { days: 45 }
          }
        ],
        { days: 30 },
        'Records are due 30 days after the request'
      )
    )
  });
  g.add('allowed', 'billing.due-after-days', { label: 'Due After the Days Allowed' });
  g.add('dueOn', 'std.logic.choose', {
    label: 'Requested Due Date, Else the Days Allowed',
    config: { mode: 'first', type: 'string', count: 2 }
  });
  g.add('requested', 'std.logic.condition', {
    label: 'The Request Names a Due Date',
    config: {
      inputs: [{ name: 'requestedDue', type: 'string' }],
      rules: [{ field: 'requestedDue', op: 'present' }]
    }
  });
  g.add('reasons', 'std.logic.select', {
    label: 'Why',
    values: { whenTrue: ['The request names its due date'] }
  });
  g.ret('return');
  g.wire('entry.payerKind', 'decide.payerKind');
  g.wire('entry.requestedDue', 'dueOn.option1', 'requested.requestedDue');
  g.wire('decide.days', 'allowed.days');
  g.wire('allowed.dueOn', 'dueOn.option2');
  g.wire('dueOn.value', 'return.dueOn');
  g.wire('requested.result', 'reasons.condition');
  g.wire('decide.reasons', 'reasons.whenFalse');
  g.wire('reasons.result', 'return.reasons');
  return g.def;
};

const closingApproval = (): GraphDef => {
  const g = rule(
    [
      d('balanceCents', 'integer', 'Balance', 'The balance the claim would close with (cents).'),
      d(
        'thresholdCents',
        'integer',
        'Approval Threshold',
        'The largest balance closed without approval (cents), from the Claim Policy table.'
      )
    ],
    [
      d(
        'needsApproval',
        'boolean',
        'Needs Approval',
        'Whether someone who may approve must agree first.'
      ),
      P.reasons('approval is or is not needed')
    ]
  );
  g.add('needs', 'std.logic.greater', { label: 'Above the Threshold' });
  g.add('reasons', 'std.logic.select', {
    label: 'Why',
    values: {
      whenTrue: ['The balance is above the approval threshold of the Claim Policy'],
      whenFalse: ['The balance is within the approval threshold of the Claim Policy']
    }
  });
  g.ret('return');
  g.wire('entry.balanceCents', 'needs.a');
  g.wire('entry.thresholdCents', 'needs.b');
  g.wire('needs.result', 'return.needsApproval', 'reasons.condition');
  g.wire('reasons.result', 'return.reasons');
  return g.def;
};

const PROTECTION_INPUTS = [
  field('state', 'string', 'State of the pickup'),
  field('planType', 'string', 'Plan type: fully_insured, self_funded or government'),
  field('payerKind', 'string', 'Claim filing indicator of the last payer, or patient'),
  field('dualEligible', 'boolean', 'Medicare and Medicaid are both on the claim'),
  field('serviceDate', 'string', 'Date of service (YYYY-MM-DD)')
];

const stateLaw = (state: string, name: string, from: string) => ({
  label: `${name}: ground ambulance balance billing limited to in-network cost share for fully insured plans from ${from} (verify)`,
  when: {
    state: is(state),
    planType: is('fully_insured'),
    serviceDate: { op: 'gte', value: from }
  },
  set: { protection: 'cap' }
});

const patientResponsibility = (): GraphDef => {
  const g = rule(
    [
      d(
        'patientBalance',
        T.patientBalance,
        'Patient Balance Facts',
        'The balance, the cost share the last payer stated, the state, date of service and plan type.'
      )
    ],
    [
      d(
        'protection',
        'string',
        'Protection',
        'none, cap (in-network cost share only) or block (no balance billing).'
      ),
      d('excessCents', 'integer', 'Protected', 'What the patient may not be billed (cents).'),
      d(
        'responsibilityCents',
        'integer',
        'Patient Responsibility',
        'What the patient may be billed (cents).'
      ),
      P.reasons('the patient is billed this much')
    ]
  );
  g.add('facts', 'billing.patient-balance-facts.break');
  g.add('decide', 'std.table.decide', {
    label: 'Balance-Billing Protection',
    config: shared.decision(
      'billing.balance-billing-protection',
      'Balance-Billing Protection',
      'Whether the law keeps part of the balance off the patient: by state, plan type (fully insured, self-funded ERISA or government), kind of payer, Medicare and Medicaid both on the claim, and date of service. cap bills only the in-network cost share the payer stated; block bills the patient nothing. The state rows are examples to verify before relying on them.',
      table(
        PROTECTION_INPUTS,
        [field('protection', 'string', 'Protection')],
        [
          {
            label:
              'Medicare and Medicaid are both on the claim: a QMB or Medicaid enrollee owes no Medicare cost sharing (SSA 1902(n)(3)(B))',
            when: { dualEligible: is(true) },
            set: { protection: 'block' }
          },
          {
            label:
              'Medicaid payment is payment in full: the patient owes only the cost share Medicaid stated (42 CFR 447.15)',
            when: { payerKind: is('MC') },
            set: { protection: 'cap' }
          },
          {
            label:
              'Medicare ambulance claims take assignment: the patient owes the deductible and coinsurance only',
            when: { payerKind: oneOf(...MEDICARE) },
            set: { protection: 'cap' }
          },
          {
            label: 'Self-funded (ERISA) plans are outside state balance-billing laws',
            when: { planType: is('self_funded') },
            set: { protection: 'none' }
          },
          stateLaw('NH', 'New Hampshire', '2026-01-01'),
          stateLaw('OR', 'Oregon', '2026-01-01'),
          stateLaw('AL', 'Alabama', '2026-10-01')
        ],
        { protection: 'none' },
        'No balance-billing protection applies'
      )
    )
  });
  g.add('wholeBalance', 'std.math.max', { label: 'Whole Balance', values: { b: 0 } });
  g.add('beyondShare', 'std.math.subtract', { label: 'Beyond the Cost Share' });
  g.add('beyondShareOwed', 'std.math.max', { label: 'Above the Cost Share', values: { b: 0 } });
  g.add('excess', 'std.logic.choose', {
    label: 'Protected Amount',
    config: { mode: 'byCase', type: 'integer', cases: [{ when: 'block' }, { when: 'cap' }] },
    values: { otherwise: 0 }
  });
  g.add('left', 'std.math.subtract', { label: 'Balance Less Protected' });
  g.add('owed', 'std.math.max', { label: 'Patient Responsibility', values: { b: 0 } });
  g.ret('return');
  g.wire('entry.patientBalance', 'facts.patientBalance');
  for (const { name } of PROTECTION_INPUTS) g.wire(`facts.${name}`, `decide.${name}`);
  g.wire('decide.protection', 'excess.key', 'return.protection');
  g.wire('facts.balanceCents', 'wholeBalance.a', 'beyondShare.a', 'left.a');
  g.wire('facts.costShareCents', 'beyondShare.b');
  g.wire('beyondShare.result', 'beyondShareOwed.a');
  g.wire('wholeBalance.result', 'excess.case1');
  g.wire('beyondShareOwed.result', 'excess.case2');
  g.wire('excess.value', 'left.b', 'return.excessCents');
  g.wire('left.result', 'owed.a');
  g.wire('owed.result', 'return.responsibilityCents');
  g.wire('decide.reasons', 'return.reasons');
  return g.def;
};

const PAYER_FIELDS = ['payerId', 'memberId'];

const DECISION_FIELDS = [
  { name: 'correction', type: 'string', label: 'Correction', options: ['replace', 'void'] },
  { name: 'payerClaimNumber', type: 'string', label: 'Payer claim number' },
  ...CLAIM_FIX_FIELDS.filter((f) => PAYER_FIELDS.includes(f.name)).map((f) => ({
    ...f,
    required: ['billAnotherPayer']
  }))
];

const workDenial = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: ['done', 'writeOff', 'void'],
    inputs: claimInputs,
    outputs: [],
    exits: { done: DONE, writeOff: WRITE_OFF, void: VOID }
  });
  g.add('follow', 'billing.follow-claim', { label: 'Show on the Claim' });
  g.add('read', 'billing.read-denial', { label: 'Read Denial' });
  g.add('category', 'billing.denial-category', { label: 'Denial Category' });
  g.add('choices', 'billing.fix-claim-form', {
    label: 'Directory Choices',
    values: { all: true, issues: [] }
  });
  g.add('directory', 'std.object.pick', {
    label: 'Directory Payers',
    values: { keys: ['payerId'] }
  });
  taskDetails(g, 'Denial Details', 'Denial and Suggestion', [
    { name: 'denial', type: T.denial },
    { name: 'suggested', type: 'string' },
    { name: 'why', type: { list: 'string' } }
  ]);
  g.add('facts', 'billing.denial-facts.break');
  g.add('defaults', 'std.object.make', {
    label: 'Prefilled',
    config: {
      fields: [
        { name: 'correction', type: 'string' },
        { name: 'payerClaimNumber', type: 'string' }
      ]
    },
    values: { correction: 'replace' }
  });
  orElse(g, 'payer', 'Payer, Else The Payer', 'The payer');
  g.add('codes', 'std.text.join', { label: 'Reason Codes', values: { separator: ', ' } });
  above(g, 'owes', 'Balance Left', 'balanceCents', 0);
  g.add('balance', 'std.text.money', { label: 'Balance' });
  g.add('leaving', 'std.logic.select', { label: 'Balance Left Open' });
  g.add('suggested', 'std.logic.choose', {
    label: 'Suggested Decision Text',
    config: {
      mode: 'byCase',
      type: 'string',
      cases: Object.keys(SUGGESTIONS).map((when) => ({ when }))
    },
    values: {
      ...Object.fromEntries(Object.values(SUGGESTIONS).map((text, i) => [`case${i + 1}`, text])),
      otherwise: 'decide whether to correct, appeal, rebill or write it off'
    }
  });
  g.add('decide', 'std.human.task', {
    label: 'Denial Decision',
    config: {
      title: 'Denial decision',
      queue: 'billing-reconcile',
      instructions:
        'The payer denied this claim. The denial, its reason codes and the suggested decision with why are in the details. Correct the claim (a replacement or void, or a reopening where the payer takes no corrected claims), appeal it, bill another payer (choose it), move the balance to the patient, or write it off.',
      fields: DECISION_FIELDS,
      outcomes: ['correctClaim', 'appeal', 'billAnotherPayer', 'moveToPatient', 'writeOff'],
      hints: {
        correctClaim:
          'Queues a replacement or files a void, or opens a Request Reopening task where the payer needs one.',
        appeal:
          'Builds the appeal packet and opens a Send Appeal task, then waits for the payer to decide.',
        billAnotherPayer: 'Adds the chosen payer to the claim and moves on to bill it.',
        moveToPatient: 'Skips the remaining payers; the balance is billed to the patient.',
        writeOff:
          'Writes off the balance and closes the claim, once approved when it is above the approval limit.'
      },
      prefill: 'suggested'
    }
  });
  g.add('correct', 'billing.correct-claim', { label: 'Correct Claim' });
  g.add('appeal', 'billing.appeal-claim', { label: 'Appeal Claim' });
  g.add('addPayer', 'billing.add-payer', { label: 'Add the Other Payer' });
  recordEvent(g, 'otherPayer', 'reconciled', 'Move On to the Other Payer');
  recordEvent(g, 'toPatient', 'reconciled', 'Move On to the Patient');
  g.add('skipRest', 'billing.skip-remaining-payers', { label: 'Skip Remaining Payers' });
  g.ret('doneReturn', 'done');
  g.ret('writeOffReturn', 'writeOff');
  g.ret('voidReturn', 'void');
  g.wire('entry.exec', 'follow.exec');
  g.wire(
    'entry.claimId',
    'follow.claimId',
    'read.claimId',
    'choices.claimId',
    'correct.claimId',
    'appeal.claimId',
    'addPayer.claimId',
    'otherPayer.claimId',
    'toPatient.claimId',
    'skipRest.claimId'
  );
  g.wire(
    'entry.coverageId',
    'read.coverageId',
    'correct.coverageId',
    'appeal.coverageId',
    'otherPayer.coverageId',
    'toPatient.coverageId'
  );
  g.wire('entry.subject', 'decide.subject', 'correct.subject', 'appeal.subject');
  g.wire('entry.context', 'correct.context', 'appeal.context');
  g.wire('follow.then', 'read.exec');
  g.wire('read.then', 'choices.exec');
  g.wire('read.denial', 'category.denial', 'added.denial', 'facts.denial');
  g.wire('category.suggestion', 'added.suggested', 'suggested.key');
  g.wire('category.reasons', 'added.why');
  g.wire('details.object', 'decide.context');
  g.wire('facts.payerClaimNumber', 'defaults.payerClaimNumber');
  g.wire('facts.payer', 'payer.option1');
  g.wire('facts.codes', 'codes.items');
  g.wire('facts.balanceCents', 'owes.balanceCents', 'balance.cents');
  g.wire('owes.result', 'leaving.condition');
  g.wire('balance.text', 'leaving.whenTrue');
  summary(
    g,
    'decide',
    '{payer} denied this claim[ ({codes})][, leaving {balance} open]; {suggested}',
    {
      payer: 'payer.value',
      codes: 'codes.text',
      balance: 'leaving.result',
      suggested: 'suggested.value'
    }
  );
  g.wire('defaults.object', 'decide.defaults');
  g.wire('choices.then', 'decide.exec');
  g.wire('choices.options', 'directory.object');
  g.wire('directory.object', 'decide.options');
  g.wire('decide.correctClaim', 'correct.exec');
  g.wire('decide.correction', 'correct.correction');
  g.wire('decide.payerClaimNumber', 'correct.payerClaimNumber');
  g.wire('correct.void', 'voidReturn.exec');
  g.wire('correct.done', 'doneReturn.exec');
  g.wire('decide.appeal', 'appeal.exec');
  g.wire('appeal.done', 'doneReturn.exec');
  g.wire('decide.billAnotherPayer', 'addPayer.exec');
  for (const pin of PAYER_FIELDS) g.wire(`decide.${pin}`, `addPayer.${pin}`);
  g.wire('addPayer.then', 'otherPayer.exec');
  g.wire('otherPayer.then', 'doneReturn.exec');
  g.wire('decide.moveToPatient', 'toPatient.exec');
  g.wire('toPatient.then', 'skipRest.exec');
  g.wire('skipRest.then', 'doneReturn.exec');
  g.wire('decide.writeOff', 'writeOffReturn.exec');
  return g.def;
};

const correctClaim = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: ['done', 'void'],
    inputs: [
      p('claimId', { id: 'claim' }),
      d(
        'coverageId',
        { id: 'coverage' },
        'Payer',
        'The payer on the claim whose claim is corrected.'
      ),
      p('subject', 'string', true),
      p('context', 'any', true),
      d('correction', 'string', 'Correction', 'replace or void, as the biller asked.', true),
      d(
        'payerClaimNumber',
        'string',
        'Payer Claim Number',
        'The payer claim number the correction replaces, when the biller entered one.',
        true
      )
    ],
    outputs: [],
    exits: {
      done: exit('Done', 'The correction was queued, filed or requested; the cycle goes on.'),
      void: VOID
    }
  });
  g.add('read', 'billing.read-denial', { label: 'Read Payer Answer' });
  g.add('method', 'billing.correction-method', { label: 'Correction Method' });
  g.add('route', 'std.flow.switch', {
    label: 'By Method',
    config: { cases: ['newClaim', 'replacement', 'void', 'reopening'] }
  });
  g.add('facts', 'billing.denial-facts.break');
  g.add('number', 'std.logic.coalesce', { label: 'Claim Number to Replace' });
  orElse(g, 'payer', 'Payer, Else the Payer', 'the payer');
  recordEvent(g, 'replace', 'resubmit_queued', 'Queue the Replacement Claim');
  recordEvent(g, 'newClaim', 'resubmit_queued', 'Queue a New Claim');
  g.add('fix', 'billing.fix-claim', { label: 'Correct the Claim Data', values: { all: true } });
  recordEvent(g, 'reopenVoid', 'resubmit_queued', 'Reopen for the Void');
  g.add('submit', 'billing.submit-to-payer', { label: 'Submit the Void' });
  recordEvent(g, 'voided', 'payer_skipped', 'Move On From the Voided Payer');
  g.add('reopening', 'std.human.task', {
    label: 'Request Reopening',
    config: {
      title: 'Request reopening',
      queue: 'billing-reconcile',
      instructions:
        'This payer corrects processed claims through a reopening, not a corrected claim (for Medicare, a clerical reopening through the MAC portal, by phone or in writing). Request it with the correction, enter the reference you were given, and mark it requested; the claim waits for the payer to reprocess it. If it cannot be reopened, say so and decide again.',
      fields: [
        {
          name: 'reference',
          type: 'string',
          label: 'Reopening reference',
          required: ['requested']
        }
      ],
      outcomes: ['requested', 'cannotReopen'],
      hints: {
        requested:
          'Logs the reopening with its reference; the claim waits for the payer to reprocess it.',
        cannotReopen:
          'Ends this correction without logging anything; the claim cycle decides again.'
      }
    }
  });
  template(g, 'reopenNote', 'Reopening Note', 'Reopening requested: {reference}');
  recordEvent(g, 'requested', 'reopening_requested', 'Log the Reopening Request');
  g.ret('doneReturn', 'done');
  g.ret('voidReturn', 'void');
  g.wire('entry.exec', 'read.exec');
  g.wire(
    'entry.claimId',
    'read.claimId',
    'replace.claimId',
    'newClaim.claimId',
    'fix.claimId',
    'reopenVoid.claimId',
    'submit.claimId',
    'voided.claimId',
    'requested.claimId'
  );
  g.wire(
    'entry.coverageId',
    'read.coverageId',
    'replace.coverageId',
    'newClaim.coverageId',
    'reopenVoid.coverageId',
    'submit.coverageId',
    'voided.coverageId',
    'requested.coverageId'
  );
  g.wire('entry.subject', 'fix.subject', 'submit.subject', 'reopening.subject');
  g.wire('entry.context', 'fix.context', 'submit.context', 'reopening.context');
  g.wire('entry.correction', 'method.correction');
  g.wire('entry.payerClaimNumber', 'number.value', 'method.payerClaimNumber');
  g.wire('read.denial', 'method.denial', 'facts.denial');
  g.wire('facts.payerClaimNumber', 'number.fallback');
  g.wire('facts.payer', 'payer.option1');
  g.wire('read.then', 'route.exec');
  g.wire('method.method', 'route.value');
  g.wire('number.result', 'replace.payerClaimNumber', 'reopenVoid.payerClaimNumber');
  g.wire('route.replacement', 'replace.exec');
  g.wire('replace.then', 'fix.exec');
  g.wire('route.newClaim', 'newClaim.exec');
  g.wire('newClaim.then', 'fix.exec');
  g.wire('fix.fixed', 'doneReturn.exec');
  g.wire('fix.backToReview', 'doneReturn.exec');
  g.wire('fix.voided', 'voidReturn.exec');
  g.wire('route.void', 'reopenVoid.exec');
  g.wire('reopenVoid.then', 'submit.exec');
  g.wire('method.frequency', 'submit.frequency');
  g.wire('submit.sent', 'voided.exec');
  g.wire('submit.retry', 'submit.exec');
  g.wire('submit.skipped', 'doneReturn.exec');
  g.wire('submit.stale', 'doneReturn.exec');
  g.wire('submit.void', 'voidReturn.exec');
  g.wire('voided.then', 'doneReturn.exec');
  g.wire('route.reopening', 'reopening.exec');
  g.wire('route.default', 'doneReturn.exec');
  summary(
    g,
    'reopening',
    'Request a reopening from {payer}[ of its claim {number}], since it takes no corrected claims, and enter the reference you are given',
    { payer: 'payer.value', number: 'facts.payerClaimNumber' }
  );
  g.wire('reopening.requested', 'requested.exec');
  g.wire('reopening.reference', 'reopenNote.reference');
  g.wire('reopenNote.text', 'requested.note');
  g.wire('requested.then', 'doneReturn.exec');
  g.wire('reopening.cannotReopen', 'doneReturn.exec');
  return g.def;
};

const appealClaim = (): GraphDef => {
  const g = graph(
    {
      execIn: ['exec'],
      execOut: ['done'],
      inputs: claimInputs,
      outputs: [],
      exits: { done: exit('Done', 'The appeal was decided, withdrawn or not sent.') }
    },
    [
      { name: 'waiting', type: 'boolean', default: true },
      { name: 'decideBy', type: 'datetime', default: null }
    ]
  );
  g.add('read', 'billing.read-denial', { label: 'Read Denial' });
  g.add('level', 'billing.appeal-level', { label: 'Appeal Level and Deadline' });
  g.add('packet', 'billing.build-appeal-packet', { label: 'Build Appeal Packet' });
  g.add('appealAt', 'std.object.make', {
    label: 'Appeal Level and Due Date',
    config: {
      fields: [
        { name: 'level', type: 'string' },
        { name: 'dueOn', type: 'string' }
      ]
    }
  });
  taskDetails(g, 'Appeal Details', 'Appeal and Denial', [
    { name: 'appeal', type: { object: { level: 'string', dueOn: 'string' } } },
    { name: 'denial', type: T.denial },
    { name: 'why', type: { list: 'string' } }
  ]);
  g.add('facts', 'billing.denial-facts.break');
  orElse(g, 'levelOrAppeal', 'Level, Else Appeal', 'appeal');
  g.add('levelWords', 'std.text.lower', { label: 'Level in Words' });
  orElse(g, 'payer', 'Payer, Else the Payer', 'the payer');
  orElse(g, 'deniedBy', 'Payer, Else The Payer', 'The payer');
  g.add('codes', 'std.text.join', { label: 'Reason Codes', values: { separator: ', ' } });
  g.add('send', 'std.human.task', {
    label: 'Send Appeal',
    config: {
      title: 'Send appeal',
      queue: 'billing-reconcile',
      instructions:
        'The appeal packet (request letter, claim summary, patient care report and the documents on the claim) is in the claim files. Add anything else that supports the claim, send it to the payer before the due date, and mark it sent. If the claim is not worth appealing, say so and decide again.',
      fields: [{ name: 'note', type: 'string', label: 'How it was sent' }],
      outcomes: ['sent', 'notAppealing'],
      hints: {
        sent: "Logs the appeal as sent and waits for the payer's decision; a task comes if it is overdue.",
        notAppealing:
          'Ends the appeal without sending it; the denial comes back for a new decision.'
      }
    }
  });
  template(g, 'sentNote', 'Appeal Note', '{levelName} sent[ ({note})], due by {dueOn}');
  recordEvent(g, 'appealed', 'appealed', 'Log the Appeal');
  g.add('waitDays', 'std.math.divide', { label: 'Decision Wait in Days', values: { b: DAY_MS } });
  g.add('deadline', 'std.time.add', { label: 'Decision Deadline', config: { unit: 'days' } });
  g.add('setDeadline', 'std.var.set', { label: 'Decide By', config: { name: 'decideBy' } });
  g.add('extendDeadline', 'std.var.set', {
    label: 'Wait Another Period',
    config: { name: 'decideBy' }
  });
  g.add('decideBy', 'std.var.get', { label: 'Decision Due', config: { name: 'decideBy' } });
  g.add('clock', 'std.time.now', { label: 'Now' });
  g.add('untilDue', 'std.time.difference', {
    label: 'Seconds Until Due',
    config: { unit: 'seconds' }
  });
  g.add('secondsLeft', 'std.math.max', { label: 'Seconds Left', values: { b: 0 } });
  g.add('timeLeft', 'std.math.multiply', { label: 'Time Left', values: { b: 1000 } });
  g.add('waiting', 'std.var.get', { label: 'Still Waiting', config: { name: 'waiting' } });
  g.add('loop', 'std.flow.while', { label: 'Until the Appeal Is Decided' });
  g.add('outcome', 'billing.read-appeal', { label: 'Read Appeal Outcome' });
  g.add('answered', 'std.flow.branch', { label: 'Did the Payer Answer?' });
  g.add('decision', 'billing.appeal-decision', { label: 'Appeal Decision' });
  template(g, 'decisionNote', 'Decision Note', '{levelName} {decision}');
  recordEvent(g, 'decided', 'appeal_decided', 'Log the Decision');
  g.add('wait', 'std.flow.wait-signal', {
    label: 'Await the Decision',
    values: { name: CLAIM_SIGNAL }
  });
  g.add('overdue', 'std.human.task', {
    label: 'Appeal Decision Overdue',
    config: {
      title: 'Appeal decision overdue',
      queue: 'billing-followup',
      instructions:
        'The payer has not answered the appeal in the time it allows. Check its status with the payer. Keep waiting, record that it upheld the denial (the claim goes back to a denial decision, where the next level can be appealed), or withdraw the appeal.',
      outcomes: ['keepWaiting', 'upheld', 'withdrawn'],
      hints: {
        keepWaiting:
          "Waits another period for the payer's decision; this task comes back if it is still overdue.",
        upheld:
          'Logs the denial as upheld; the claim goes back to a denial decision, where the next level can be appealed.',
        withdrawn:
          'Stops waiting on the appeal and ends it without logging a decision; the claim cycle goes on.'
      }
    }
  });
  recordEvent(g, 'upheld', 'appeal_decided', 'Log the Upheld Denial');
  for (const id of ['stopDecided', 'stopUpheld', 'stopWithdrawn']) {
    g.add(id, 'std.var.set', {
      label: 'Stop Waiting',
      config: { name: 'waiting' },
      values: { value: false }
    });
  }
  g.ret('doneReturn', 'done');
  g.wire('entry.exec', 'read.exec');
  g.wire(
    'entry.claimId',
    'read.claimId',
    'packet.claimId',
    'appealed.claimId',
    'outcome.claimId',
    'decided.claimId',
    'wait.key',
    'upheld.claimId'
  );
  g.wire(
    'entry.coverageId',
    'read.coverageId',
    'packet.coverageId',
    'appealed.coverageId',
    'outcome.coverageId',
    'decided.coverageId',
    'upheld.coverageId'
  );
  g.wire('entry.subject', 'send.subject', 'overdue.subject');
  g.wire('read.denial', 'level.denial', 'added.denial', 'facts.denial');
  g.wire('read.then', 'packet.exec');
  g.wire(
    'level.levelName',
    'packet.level',
    'appealAt.level',
    'sentNote.levelName',
    'decisionNote.levelName',
    'levelOrAppeal.option1'
  );
  g.wire('level.dueOn', 'packet.dueOn', 'appealAt.dueOn', 'send.due', 'sentNote.dueOn');
  g.wire('appealAt.object', 'added.appeal');
  g.wire('level.reasons', 'added.why');
  g.wire('details.object', 'send.context', 'overdue.context');
  g.wire('levelOrAppeal.value', 'levelWords.text');
  g.wire('facts.payer', 'payer.option1', 'deniedBy.option1');
  g.wire('facts.codes', 'codes.items');
  summary(
    g,
    'send',
    'Send the {level} to {payer}[ against its {codes} denial][ by {dueOn}]; the packet is in the claim files',
    { level: 'levelWords.result', payer: 'payer.value', codes: 'codes.text', dueOn: 'level.dueOn' }
  );
  summary(
    g,
    'overdue',
    '{payer} has not decided the {level} in time; check its status, then keep waiting, record it upheld or withdraw it',
    { payer: 'deniedBy.value', level: 'levelWords.result' }
  );
  g.wire('packet.then', 'send.exec');
  g.wire('send.notAppealing', 'doneReturn.exec');
  g.wire('send.sent', 'appealed.exec');
  g.wire('send.note', 'sentNote.note');
  g.wire('sentNote.text', 'appealed.note');
  g.wire('appealed.then', 'setDeadline.exec');
  g.wire('setDeadline.then', 'loop.exec');
  g.wire('level.decisionWaitMs', 'waitDays.a');
  g.wire('clock.now', 'deadline.time', 'untilDue.start');
  g.wire('waitDays.result', 'deadline.amount');
  g.wire('deadline.time', 'setDeadline.value', 'extendDeadline.value');
  g.wire('decideBy.value', 'untilDue.end');
  g.wire('untilDue.amount', 'secondsLeft.a');
  g.wire('secondsLeft.result', 'timeLeft.a');
  g.wire('overdue.keepWaiting', 'extendDeadline.exec');
  g.wire('waiting.value', 'loop.condition');
  g.wire('loop.body', 'outcome.exec');
  g.wire('loop.completed', 'doneReturn.exec');
  g.wire('outcome.then', 'answered.exec');
  g.wire('outcome.decided', 'answered.condition');
  g.wire('outcome.paidCents', 'decision.paidCents');
  g.wire('outcome.balanceCents', 'decision.balanceCents');
  g.wire('decision.decision', 'decisionNote.decision');
  g.wire('decisionNote.text', 'decided.note');
  g.wire('answered.true', 'decided.exec');
  g.wire('decided.then', 'stopDecided.exec');
  g.wire('answered.false', 'wait.exec');
  g.wire('outcome.signalsSeen', 'wait.after');
  g.wire('timeLeft.result', 'wait.timeoutMs');
  g.wire('wait.timeout', 'overdue.exec');
  g.wire('overdue.upheld', 'upheld.exec');
  g.wire('upheld.then', 'stopUpheld.exec');
  g.wire('overdue.withdrawn', 'stopWithdrawn.exec');
  template(g, 'upheldNote', 'Upheld Note', '{levelName} upheld, as a biller recorded', {
    levelName: 'level.levelName'
  });
  g.wire('upheldNote.text', 'upheld.note');
  return g.def;
};

const logRecordsRequest = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [
      p('claimId', { id: 'claim' }),
      d('coverageId', { id: 'coverage' }, 'Payer', 'The payer asking for records, if known.', true),
      p('assignee', 'string', true)
    ],
    outputs: []
  });
  g.add('follow', 'billing.follow-claim', { label: 'Show on the Claim' });
  g.add('ledger', 'billing.read-claim-ledger', { label: 'Read Claim Ledger' });
  g.add('facts', 'billing.claim-ledger.break');
  g.add('payer', 'std.logic.choose', {
    label: 'Payer Asking',
    config: { mode: 'first', type: { id: 'coverage' }, count: 3 }
  });
  g.add('asking', 'billing.read-payer', { label: 'Read the Payer Asking' });
  g.add('due', 'billing.records-due', { label: 'Records Due' });
  template(
    g,
    'requestNote',
    'Request Note',
    'Records requested[ by {payer}], due {dueOn}[: {note}]'
  );
  recordEvent(g, 'requested', 'records_requested', 'Log the Records Request');
  g.add('details', 'std.object.make', {
    label: 'Request Details',
    config: {
      fields: [
        { name: 'claimId', type: { id: 'claim' } },
        { name: 'dueOn', type: 'string' },
        { name: 'request', type: 'string' },
        { name: 'why', type: { list: 'string' } }
      ]
    }
  });
  orElse(g, 'payerName', 'Payer, Else The Payer', 'The payer');
  g.add('gather', 'std.human.task', {
    label: 'Send Records',
    config: {
      title: 'Send records',
      queue: 'billing-review',
      instructions:
        'The payer asked for records on this claim (an additional documentation request). Gather what it asks for, usually the patient care report, the physician certification, signatures and the facesheet, and send it before the due date, then mark it sent.',
      fields: [{ name: 'note', type: 'string', label: 'What was sent' }],
      outcomes: ['sent', 'cannotSend'],
      hints: {
        sent: 'Logs the records as sent on the claim, with what was sent, and closes the request.',
        cannotSend: 'Closes the request without logging records as sent.'
      }
    }
  });
  recordEvent(g, 'sent', 'records_sent', 'Log the Records Sent');
  g.add('log', 'std.human.task', {
    label: 'Log Records Request',
    config: {
      title: 'Log records request',
      queue: 'billing-review',
      permission: 'claims:update',
      instructions:
        'Enter the request for records a payer sent about this claim (an additional documentation request): the due date it names, or none for the days the payer allows (Records Deadlines table), and what it asks for. A Send records task then waits for the records, due on that date.',
      fields: [
        {
          name: 'dueOn',
          type: 'string',
          label: 'Due date (empty for the days the payer allows)',
          format: 'date'
        },
        { name: 'note', type: 'string', label: 'Records requested' }
      ],
      outcomes: ['log', 'cancel'],
      hints: {
        log: 'Logs the request on the claim and opens a Send records task due on its due date.',
        cancel: 'Closes the task without logging a request.'
      }
    }
  });
  summary(
    g,
    'log',
    'Log the request for records a payer sent about claim {reference}, with its due date',
    { reference: 'ledger.reference' }
  );
  g.ret('done');
  g.wire('entry.exec', 'follow.exec');
  g.wire('entry.assignee', 'log.assignee');
  g.wire('log.cancel', 'done.exec');
  g.wire(
    'entry.claimId',
    'follow.claimId',
    'ledger.claimId',
    'asking.claimId',
    'requested.claimId',
    'details.claimId',
    'sent.claimId'
  );
  g.wire('entry.coverageId', 'payer.option1');
  g.wire('log.dueOn', 'due.requestedDue');
  g.wire('log.note', 'requestNote.note', 'details.request');
  g.wire('follow.then', 'ledger.exec');
  g.wire('ledger.ledger', 'facts.ledger');
  g.wire('ledger.reference', 'log.subject', 'gather.subject');
  g.wire('facts.unreconciledCoverageId', 'payer.option2');
  g.wire('facts.coverageId', 'payer.option3');
  g.wire('asking.payerKind', 'due.payerKind');
  g.wire('asking.payer', 'requestNote.payer', 'payerName.option1');
  g.wire('due.dueOn', 'requestNote.dueOn', 'details.dueOn', 'gather.due');
  g.wire('due.reasons', 'details.why');
  g.wire('payer.value', 'asking.coverageId', 'requested.coverageId', 'sent.coverageId');
  g.wire('requestNote.text', 'requested.note');
  g.wire('ledger.then', 'log.exec');
  g.wire('log.log', 'asking.exec');
  g.wire('asking.then', 'requested.exec');
  g.wire('requested.then', 'gather.exec');
  g.wire('details.object', 'gather.context');
  summary(
    g,
    'gather',
    '{payer} asked for records on this claim[, due {dueOn}][ ({note})]; send them and mark it sent',
    { payer: 'payerName.value', dueOn: 'due.dueOn', note: 'log.note' }
  );
  g.wire('gather.sent', 'sent.exec');
  g.wire('gather.note', 'sent.note');
  g.wire('sent.then', 'done.exec');
  g.wire('gather.cannotSend', 'done.exec');
  return g.def;
};

const refundOverpayment = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: ['refunded', 'keptCredit'],
    inputs: [
      p('claimId', { id: 'claim' }),
      p('subject', 'string', true),
      p('context', 'any', true)
    ],
    outputs: [],
    exits: {
      refunded: exit(
        'Refunded',
        'The refund was approved and recorded on the claim, or the credit was gone by then.'
      ),
      keptCredit: exit('Kept Credit', 'Someone who may approve refunds kept the credit.')
    }
  });
  g.add('follow', 'billing.follow-claim', { label: 'Show on the Claim' });
  g.add('read', 'billing.read-refund', { label: 'Read Credit Balance' });
  g.add('due', 'billing.refund-due', { label: 'Refund Due' });
  taskDetails(g, 'Refund Details', 'Refund and Due Date', [
    { name: 'refund', type: T.refund },
    { name: 'dueOn', type: 'string' },
    { name: 'why', type: { list: 'string' } }
  ]);
  g.add('facts', 'billing.refund-facts.break');
  orElse(g, 'payerName', 'Payer, Else The Patient', 'The patient');
  g.add('overpaid', 'std.text.money', { label: 'Overpaid' });
  template(g, 'paidMore', 'Paid More', '[paid {overpaid} more than this claim charges]', {
    overpaid: 'overpaid.text'
  });
  orElse(g, 'paid', 'What Was Paid', 'overpaid this claim');
  g.add('approve', 'std.human.task', {
    label: 'Approve Refund',
    config: {
      title: 'Approve refund',
      queue: 'billing-approvals',
      permission: 'claims:approve',
      instructions:
        'More has been paid on this claim than it charges. The credit balance, who paid it and the day the refund is due are in the details (Medicare and Medicaid overpayments must be returned within 60 days of being identified). Approve the refund to record it on the claim, then send it; or keep the credit.',
      fields: [{ name: 'note', type: 'string', label: 'Refund reference' }],
      outcomes: ['refund', 'keepCredit'],
      hints: {
        refund:
          'Records a refund of the credit still owed on the claim, to whoever paid it; then send the refund.',
        keepCredit: 'Keeps the credit and closes the claim as paid.'
      }
    }
  });
  template(g, 'refundNote', 'Refund Note', 'Refund approved[: {note}]');
  g.add('reread', 'billing.read-refund', { label: 'Read Credit Balance Again' });
  g.add('credit', 'billing.refund-facts.break', { label: 'Credit Now' });
  g.add('smaller', 'std.math.min', { label: 'Credit or What Was Paid' });
  g.add('amount', 'std.math.max', { label: 'Refund Amount', values: { b: 0 } });
  above(g, 'anything', 'Anything to Refund', 'amount', 0);
  g.add('owed', 'std.flow.branch', { label: 'Still Owed?' });
  g.add('record', 'billing.record-refund', { label: 'Record Refund' });
  g.ret('refundedReturn', 'refunded');
  g.ret('keptReturn', 'keptCredit');
  g.wire('entry.exec', 'follow.exec');
  g.wire('entry.claimId', 'follow.claimId', 'read.claimId', 'reread.claimId', 'record.claimId');
  g.wire('entry.subject', 'approve.subject');
  g.wire('follow.then', 'read.exec');
  g.wire('read.refund', 'due.refund', 'added.refund', 'facts.refund');
  g.wire('due.dueOn', 'added.dueOn', 'approve.due');
  g.wire('due.reasons', 'added.why');
  g.wire('details.object', 'approve.context');
  g.wire('facts.payer', 'payerName.option1');
  g.wire('facts.overpaidCents', 'overpaid.cents');
  g.wire('paidMore.text', 'paid.option1');
  summary(g, 'approve', '{payer} {paid}; refund it[ by {dueOn}] or keep the credit', {
    payer: 'payerName.value',
    paid: 'paid.value',
    dueOn: 'due.dueOn'
  });
  g.wire('read.then', 'approve.exec');
  g.wire('approve.refund', 'reread.exec');
  g.wire('reread.refund', 'credit.refund');
  g.wire('credit.overpaidCents', 'smaller.a');
  g.wire('credit.paidCents', 'smaller.b');
  g.wire('smaller.result', 'amount.a');
  g.wire('amount.result', 'anything.amount', 'record.amountCents');
  g.wire('reread.then', 'owed.exec');
  g.wire('anything.result', 'owed.condition');
  g.wire('owed.true', 'record.exec');
  g.wire('owed.false', 'refundedReturn.exec');
  g.wire('approve.note', 'refundNote.note');
  g.wire('refundNote.text', 'record.note');
  g.wire('credit.coverageId', 'record.coverageId');
  g.wire('record.then', 'refundedReturn.exec');
  g.wire('approve.keepCredit', 'keptReturn.exec');
  return g.def;
};

const approveClosing = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: ['approved', 'rejected'],
    inputs: [
      p('claimId', { id: 'claim' }),
      d('closing', 'string', 'Closing', 'writeOff or collections.'),
      d('balanceCents', 'integer', 'Balance', 'The balance the claim would close with (cents).'),
      d(
        'thresholdCents',
        'integer',
        'Approval Threshold',
        'The largest balance closed without approval (cents).'
      ),
      p('subject', 'string', true),
      p('context', 'any', true)
    ],
    outputs: [],
    exits: {
      approved: exit('Approved', 'The closing needs no approval or was approved.'),
      rejected: exit('Rejected', 'The closing was not approved; the cycle decides again.')
    }
  });
  g.add('rule', 'billing.closing-approval', { label: 'Closing Approval' });
  g.add('needed', 'std.flow.branch', { label: 'Needs Approval?' });
  g.add('which', 'std.flow.switch', { label: 'Which Closing', config: { cases: ['collections'] } });
  const task = (id: string, title: string, instructions: string, approve: string) =>
    g.add(id, 'std.human.task', {
      label: `Approve ${title}`,
      config: {
        title: `Approve ${title.toLowerCase()}`,
        queue: 'billing-approvals',
        permission: 'claims:approve',
        instructions,
        outcomes: ['approve', 'reject'],
        hints: {
          approve,
          reject:
            'Sends it back without closing the claim; the claim cycle decides its next step again.'
        }
      }
    });
  task(
    'writeOff',
    'Write-Off',
    'A biller chose to write off a balance above the approval threshold of the Claim Policy. Approve the write-off to close the claim, or reject it to send it back.',
    'Logs the approval and closes the claim as written off.'
  );
  task(
    'collections',
    'Collections',
    'A biller chose to send this balance to collections, which needs approval under the Claim Policy. Approve the placement to close the claim as sent to collections, or reject it to send it back.',
    'Logs the approval and closes the claim as sent to collections.'
  );
  recordEvent(g, 'approvedWriteOff', 'closing_approved', 'Log the Approval', {
    note: 'Write-off approved'
  });
  recordEvent(g, 'approvedCollections', 'closing_approved', 'Log the Approval', {
    note: 'Collections placement approved'
  });
  g.add('balance', 'std.text.money', { label: 'Balance' });
  orElse(g, 'balanceText', 'Balance, Else This Balance', 'this balance');
  g.add('threshold', 'std.text.money', { label: 'Approval Threshold' });
  g.ret('approvedReturn', 'approved');
  g.ret('rejectedReturn', 'rejected');
  g.wire('entry.exec', 'needed.exec');
  g.wire('entry.balanceCents', 'rule.balanceCents');
  g.wire('entry.thresholdCents', 'rule.thresholdCents');
  g.wire('rule.needsApproval', 'needed.condition');
  g.wire('needed.false', 'approvedReturn.exec');
  g.wire('needed.true', 'which.exec');
  g.wire('entry.closing', 'which.value');
  g.wire('which.collections', 'collections.exec');
  g.wire('which.default', 'writeOff.exec');
  g.wire('entry.subject', 'writeOff.subject', 'collections.subject');
  g.wire('entry.context', 'writeOff.context', 'collections.context');
  g.wire('entry.balanceCents', 'balance.cents');
  g.wire('balance.text', 'balanceText.option1');
  g.wire('entry.thresholdCents', 'threshold.cents');
  summary(
    g,
    'writeOff',
    'Approve writing off {balance}[, above the {threshold} limit], or reject it to send it back',
    { balance: 'balanceText.value', threshold: 'threshold.text' }
  );
  summary(
    g,
    'collections',
    'Approve sending {balance} to collections, or reject it to send it back',
    { balance: 'balanceText.value' }
  );
  g.wire('entry.claimId', 'approvedWriteOff.claimId', 'approvedCollections.claimId');
  g.wire('writeOff.approve', 'approvedWriteOff.exec');
  g.wire('collections.approve', 'approvedCollections.exec');
  g.wire('approvedWriteOff.then', 'approvedReturn.exec');
  g.wire('approvedCollections.then', 'approvedReturn.exec');
  g.wire('writeOff.reject', 'rejectedReturn.exec');
  g.wire('collections.reject', 'rejectedReturn.exec');
  return g.def;
};

export const recoveryGraphs: SeedGraph[] = [
  asRule(
    'billing.due-after-days',
    'Due After Days',
    'Works out the last day to act: the days allowed counted from a day, or from today when there is none.',
    dueAfterDays()
  ),
  asRule(
    'billing.denial-category',
    'Denial Category',
    'Suggests what a payer denial needs (Denial Categories table): correct the claim, appeal, bill another payer, move it to the patient or write it off, with why.',
    denialCategory()
  ),
  asRule(
    'billing.correction-method',
    'Correction Method',
    "Decides how a claim the payer has is corrected (Correction Methods table): a new claim (frequency 1) when the payer never adjudicated it or returned it as unprocessable (MA130, or CO-16 from Medicare), a replacement claim (frequency 7) or void (frequency 8) with the payer claim number, or a reopening request where the payer takes no corrected claims (Medicare), by the payer directory's correction setting.",
    correctionMethod()
  ),
  asRule(
    'billing.appeal-level',
    'Appeal Level and Deadline',
    "Decides the next appeal level of a denial and the day it is due (Appeal Levels table): Medicare redetermination within 120 days of the remittance, then reconsideration within 180 days; other payers by the payer directory's appeal limit or the table default; with how long to wait for the decision.",
    appealLevel()
  ),
  asRule(
    'billing.appeal-decision',
    'Appeal Decision',
    'Decides what the remittance a payer sent after an appeal means (Appeal Decisions table): overturned, partly overturned or upheld.',
    appealDecision()
  ),
  asRule(
    'billing.records-due',
    'Records Due',
    'Decides when the records a payer asked for are due: the date the request names, else the days the Records Deadlines table allows the kind of payer.',
    recordsDue()
  ),
  asRule(
    'billing.refund-due',
    'Refund Due',
    'Decides when a credit balance must be refunded (Refund Deadlines table): Medicare and Medicaid within 60 days of being identified.',
    refundDue()
  ),
  asRule(
    'billing.closing-approval',
    'Closing Approval',
    'Decides whether closing a claim with a balance (write-off or collections) needs approval: when the balance is above the threshold the Claim Policy sets.',
    closingApproval()
  ),
  asRule(
    'billing.patient-responsibility',
    'Patient Responsibility',
    'Decides how much of the balance the patient may be billed (Balance-Billing Protection table, by state, plan type, kind of payer and date of service): all of it, only the in-network cost share the payer stated, or none, with why.',
    patientResponsibility()
  ),
  asStage(
    'billing.approve-closing',
    'Approve Closing',
    'Asks someone with the claims:approve permission to approve writing off or sending to collections a balance above the Claim Policy threshold, and logs the approval.',
    approveClosing()
  ),
  asStage(
    'billing.correct-claim',
    'Correct Claim',
    'The one way a claim the payer has is corrected, used by Work Denial, Reconcile Payment and Follow Up with Payer: decides how with Correction Method, then queues a new or replacement claim (frequency 1 or 7 with the payer claim number, filed by the claim cycle once the data is corrected and reviewed), files a void (frequency 8) through Submit to Payer and moves on from the payer, or asks a biller to request a reopening and waits for the payer to reprocess it.',
    correctClaim()
  ),
  asStage(
    'billing.appeal-claim',
    'Appeal Claim',
    'Appeals a denial: decides its level and due date (Appeal Level and Deadline), stores an appeal packet in the claim files, asks a biller to send it, then waits for the payer to decide (a new remittance, decided by Appeal Decision) and asks a biller when the decision is overdue, counted from when the appeal was sent however often the claim changes meanwhile. Used by Work Denial.',
    appealClaim()
  ),
  asWorkflow(
    'billing.work-denial',
    'Work Denial',
    'Works a payer denial that Remittance Routing routed to a denial, appeal or fix: suggests a decision (Denial Category) and asks a biller to correct the claim (Correct Claim), appeal it (Appeal Claim), bill another payer, move the balance to the patient or write it off. Started by the claim cycle.',
    workDenial()
  ),
  asWorkflow(
    'billing.log-records-request',
    'Log Records Request',
    'Started from a claim: a Log records request task enters a payer request for records (an additional documentation request) with its due date, then logs it, decides when the records are due (Records Due) by the kind of payer asking, not the one being billed, and asks a biller to gather and send them by then.',
    logRecordsRequest()
  ),
  asWorkflow(
    'billing.refund-overpayment',
    'Refund Overpayment',
    'Works a credit balance: reads who overpaid, decides when the refund is due (Refund Due), asks someone with the claims:approve permission to approve it, then reads the credit again and records a refund of what is still owed, never more than the credit balance or what that payer paid. Started by the claim cycle.',
    refundOverpayment()
  )
];
