import { CLAIM_FIX_FIELDS, CLAIM_SIGNAL } from '@ugula/billing';
import type { GraphDef } from '@ugula/graph';
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
  dollars,
  exit,
  expr,
  field,
  is,
  named,
  oneOf,
  P,
  rule,
  shared,
  summarize,
  T,
  table
} from './shared.ts';

const DAY_MS = 86_400_000;

const DENIED_BY = named('denial?.payer', "'The payer'");

const SUGGESTED = `({
  correctClaim: 'correcting it is suggested',
  appeal: 'an appeal is suggested',
  billAnotherPayer: 'billing another payer is suggested',
  moveToPatient: 'moving the balance to the patient is suggested',
  writeOff: 'writing it off is suggested'
}[suggestion ?? ''] ?? 'decide whether to correct, appeal, rebill or write it off')`;

const DENIAL_SUMMARY = `${DENIED_BY} + ' denied this claim' +
  (len(denial?.codes ?? []) > 0 ? ' (' + join(denial?.codes, ', ') + ')' : '') +
  ((denial?.balanceCents ?? 0) > 0 ? ', leaving ' + ${dollars('denial?.balanceCents')} + ' open' : '') +
  '; ' + ${SUGGESTED}`;

const VOID_BLOCKED_SUMMARY = `'The void of this claim to ' + ${named('context?.payer', "'the payer'")} + ' could not be filed: ' +
  ${named('why', "'no reason was given'")} + '; fix it and try again, or skip the payer'`;

const REOPENING_SUMMARY = `'Request a reopening from ' + ${named('denial?.payer', "'the payer'")} +
  (${named('denial?.payerClaimNumber', 'null')} != null ? ' of its claim ' + denial?.payerClaimNumber : '') +
  ', since it takes no corrected claims, and enter the reference you are given'`;

const LEVEL = `lower(${named('levelName', "'appeal'")})`;

const SEND_APPEAL_SUMMARY = `'Send the ' + ${LEVEL} + ' to ' + ${named('denial?.payer', "'the payer'")} +
  (len(denial?.codes ?? []) > 0 ? ' against its ' + join(denial?.codes, ', ') + ' denial' : '') +
  (${named('dueOn', 'null')} != null ? ' by ' + dueOn : '') + '; the packet is in the claim files'`;

const APPEAL_OVERDUE_SUMMARY = `${DENIED_BY} + ' has not decided the ' + ${LEVEL} +
  ' in time; check its status, then keep waiting, record it upheld or withdraw it'`;

const RECORDS_SUMMARY = `${named('payer', "'The payer'")} + ' asked for records on this claim' +
  (${named('dueOn', 'null')} != null ? ', due ' + dueOn : '') +
  (${named('note', 'null')} != null ? ' (' + note + ')' : '') + '; send them and mark it sent'`;

const REFUND_SUMMARY = `${named('refund?.payer', "'The patient'")} +
  (refund?.overpaidCents != null ? ' paid ' + ${dollars('refund?.overpaidCents')} + ' more than this claim charges' : ' overpaid this claim') +
  '; refund it' + (${named('dueOn', 'null')} != null ? ' by ' + dueOn : '') + ' or keep the credit'`;

const BALANCE = `(balanceCents != null ? ${dollars('balanceCents')} : 'this balance')`;

const WRITE_OFF_SUMMARY = `'Approve writing off ' + ${BALANCE} +
  (thresholdCents != null ? ', above the ' + ${dollars('thresholdCents')} + ' limit,' : ',') +
  ' or reject it to send it back'`;

const COLLECTIONS_SUMMARY = `'Approve sending ' + ${BALANCE} + ' to collections, or reject it to send it back'`;

const MEDICARE = ['MA', 'MB'];

const recordEvent = (g: Builder, id: string, kind: string, label: string) =>
  g.add(id, 'billing.record-claim-event', { label, values: { kind } });

const DENIAL_IN = d(
  'denial',
  T.denial,
  'Denial Facts',
  'The denial: payer, how it was routed, reason codes, remittance date, appeals so far and payer settings.'
);

const COVERAGE = d(
  'coverageId',
  'string',
  'Payer',
  'The payer on the claim whose denial is worked.'
);

const DONE = exit('Done', 'The denial was worked; the claim cycle decides what comes next.');

const VOID = exit('Void', 'A biller voided the claim.');

const WRITE_OFF = exit('Write Off', 'A biller chose to write off the balance.');

const claimInputs = [
  p('claimId', 'string'),
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
        { suggestion: 'appeal' }
      )
    )
  });
  g.add(
    'reasons',
    'std.expr',
    expr(
      'Why',
      'rule != null ? [rule] : ["No reason code points elsewhere, so an appeal is suggested"]'
    )
  );
  g.ret('return');
  g.wire('entry.denial', 'denial.denial');
  for (const f of ['route', 'codes', 'payerKind']) g.wire(`denial.${f}`, `decide.${f}`);
  g.wire('decide.suggestion', 'return.suggestion');
  g.wire('decide.rule', 'reasons.rule');
  g.wire('reasons.result', 'return.reasons');
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
      )
    ],
    [
      d('method', 'string', 'Method', 'replacement, void or reopening.'),
      d(
        'frequency',
        'string',
        'Frequency',
        'The claim frequency the correction is filed with: 7 replacement, 8 void.',
        true
      ),
      P.reasons('the claim is corrected this way')
    ]
  );
  g.add('denial', 'billing.denial-facts.break');
  g.add('decide', 'std.table.decide', {
    label: 'Correction Methods',
    config: shared.decision(
      'billing.correction-methods',
      'Correction Methods',
      "How a denied claim is corrected, by the payer's correction setting in the payer directory, its kind and what the biller asked for: a replacement (frequency 7), a void (frequency 8) or, where the payer takes no corrected claims, a reopening request.",
      table(
        [
          field('correctionMethod', 'string', 'Payer setting: replacement or reopening'),
          field('payerKind', 'string', 'Claim filing indicator of the payer'),
          field('correction', 'string', 'What the biller asked for: replace or void')
        ],
        [field('method', 'string', 'Method'), field('frequency', 'string', 'Claim frequency')],
        [
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
        { method: 'replacement', frequency: '7' }
      )
    )
  });
  g.add(
    'reasons',
    'std.expr',
    expr('Why', 'rule != null ? [rule] : ["Replace the claim the payer has on file (frequency 7)"]')
  );
  g.ret('return');
  g.wire('entry.denial', 'denial.denial');
  g.wire('denial.correctionMethod', 'decide.correctionMethod');
  g.wire('denial.payerKind', 'decide.payerKind');
  g.wire('entry.correction', 'decide.correction');
  g.wire('decide.method', 'return.method');
  g.wire('decide.frequency', 'return.frequency');
  g.wire('decide.rule', 'reasons.rule');
  g.wire('reasons.result', 'return.reasons');
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
        { level: 'appeal', levelName: 'Second Level Appeal', days: 60, decisionDays: 30 }
      )
    )
  });
  g.add(
    'days',
    'std.expr',
    expr(
      'Days Allowed',
      `contains(${JSON.stringify(MEDICARE)}, payerKind) ? days : coalesce(appealDays, days)`
    )
  );
  g.add('dueOn', 'std.expr', expr('Due On', 'addDays(coalesce(deniedOn, date(now())), days)'));
  g.add('wait', 'std.expr', expr('Decision Wait', `decisionDays * ${DAY_MS}`));
  g.add(
    'reasons',
    'std.expr',
    expr(
      'Why',
      'concat(rule != null ? [rule] : ["Second appeal to the payer within 60 days (verify)"], appealDays != null && days == appealDays ? ["The payer directory allows " + text(appealDays) + " days"] : [])'
    )
  );
  g.ret('return');
  g.wire('entry.denial', 'denial.denial');
  g.wire('denial.payerKind', 'decide.payerKind', 'days.payerKind');
  g.wire('denial.appeals', 'decide.appeals');
  g.wire('denial.appealDays', 'days.appealDays', 'reasons.appealDays');
  g.wire('decide.days', 'days.days');
  g.wire('days.result', 'dueOn.days', 'reasons.days');
  g.wire('denial.deniedOn', 'dueOn.deniedOn');
  g.wire('decide.decisionDays', 'wait.decisionDays');
  g.wire('decide.level', 'return.level');
  g.wire('decide.levelName', 'return.levelName');
  g.wire('dueOn.result', 'return.dueOn');
  g.wire('wait.result', 'return.decisionWaitMs');
  g.wire('decide.rule', 'reasons.rule');
  g.wire('reasons.result', 'return.reasons');
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
  g.add('paid', 'std.expr', expr('Paid Something', 'paidCents > 0'));
  g.add('settled', 'std.expr', expr('Nothing Owed', 'balanceCents <= 0'));
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
        { decision: 'upheld' }
      )
    )
  });
  g.add(
    'reasons',
    'std.expr',
    expr('Why', 'rule != null ? [rule] : ["The payer paid nothing after the appeal"]')
  );
  g.ret('return');
  g.wire('entry.paidCents', 'paid.paidCents');
  g.wire('entry.balanceCents', 'settled.balanceCents');
  g.wire('paid.result', 'decide.paid');
  g.wire('settled.result', 'decide.settled');
  g.wire('decide.decision', 'return.decision');
  g.wire('decide.rule', 'reasons.rule');
  g.wire('reasons.result', 'return.reasons');
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
        { days: otherwise }
      )
    )
  });
  g.add('dueOn', 'std.expr', expr('Due On', `addDays(coalesce(${dateField}, date(now())), days)`));
  g.add(
    'reasons',
    'std.expr',
    expr('Why', `rule != null ? [rule] : ["Due ${otherwise} days after it was found"]`)
  );
  g.ret('return');
  g.wire(`entry.${factsIn.name}`, `facts.${factsIn.name}`);
  g.wire('facts.payerKind', 'decide.payerKind');
  g.wire(`facts.${dateField}`, `dueOn.${dateField}`);
  g.wire('decide.days', 'dueOn.days');
  g.wire('dueOn.result', 'return.dueOn');
  g.wire('decide.rule', 'reasons.rule');
  g.wire('reasons.result', 'return.reasons');
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
        { days: 30 }
      )
    )
  });
  g.add(
    'dueOn',
    'std.expr',
    expr(
      'Due On',
      'requestedDue != null && requestedDue != "" ? date(requestedDue) : addDays(date(now()), days)'
    )
  );
  g.add(
    'reasons',
    'std.expr',
    expr(
      'Why',
      'requestedDue != null && requestedDue != "" ? ["The request names its due date"] : rule != null ? [rule] : ["Records are due 30 days after the request"]'
    )
  );
  g.ret('return');
  g.wire('entry.payerKind', 'decide.payerKind');
  g.wire('entry.requestedDue', 'dueOn.requestedDue', 'reasons.requestedDue');
  g.wire('decide.days', 'dueOn.days');
  g.wire('dueOn.result', 'return.dueOn');
  g.wire('decide.rule', 'reasons.rule');
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
  g.add('needs', 'std.expr', expr('Above the Threshold', 'balanceCents > thresholdCents'));
  g.add(
    'reasons',
    'std.expr',
    expr(
      'Why',
      'balanceCents > thresholdCents ? ["The balance is above the approval threshold of the Claim Policy"] : ["The balance is within the approval threshold of the Claim Policy"]'
    )
  );
  g.ret('return');
  g.wire('entry.balanceCents', 'needs.balanceCents', 'reasons.balanceCents');
  g.wire('entry.thresholdCents', 'needs.thresholdCents', 'reasons.thresholdCents');
  g.wire('needs.result', 'return.needsApproval');
  g.wire('reasons.result', 'return.reasons');
  return g.def;
};

const PROTECTION_INPUTS = [
  field('state', 'string', 'State of the pickup'),
  field('planType', 'string', 'Plan type: fully_insured, self_funded or government'),
  field('payerKind', 'string', 'Claim filing indicator of the last payer, or patient'),
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
      'Whether the law keeps part of the balance off the patient: by state, plan type (fully insured, self-funded ERISA or government), kind of payer and date of service. cap bills only the in-network cost share the payer stated; block bills the patient nothing. The state rows are examples to verify before relying on them.',
      table(
        PROTECTION_INPUTS,
        [field('protection', 'string', 'Protection')],
        [
          {
            label: 'Medicaid patients are never balance billed (42 CFR 447.15)',
            when: { payerKind: is('MC') },
            set: { protection: 'block' }
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
        { protection: 'none' }
      )
    )
  });
  g.add(
    'excess',
    'std.expr',
    expr(
      'Protected Amount',
      'protection == "block" ? max(balanceCents, 0) : protection == "cap" ? max(balanceCents - costShareCents, 0) : 0'
    )
  );
  g.add('owed', 'std.expr', expr('Patient Responsibility', 'max(balanceCents - excess, 0)'));
  g.add(
    'reasons',
    'std.expr',
    expr('Why', 'rule != null ? [rule] : ["No balance-billing protection applies"]')
  );
  g.ret('return');
  g.wire('entry.patientBalance', 'facts.patientBalance');
  for (const { name } of PROTECTION_INPUTS) g.wire(`facts.${name}`, `decide.${name}`);
  g.wire('decide.protection', 'excess.protection', 'return.protection');
  g.wire('facts.balanceCents', 'excess.balanceCents', 'owed.balanceCents');
  g.wire('facts.costShareCents', 'excess.costShareCents');
  g.wire('excess.result', 'owed.excess', 'return.excessCents');
  g.wire('owed.result', 'return.responsibilityCents');
  g.wire('decide.rule', 'reasons.rule');
  g.wire('reasons.result', 'return.reasons');
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
  g.add(
    'details',
    'std.expr',
    expr(
      'Denial Details',
      'merge(context ?? {}, { denial: denial, suggested: suggestion, why: reasons })'
    )
  );
  g.add(
    'defaults',
    'std.expr',
    expr('Prefilled', '{ correction: "replace", payerClaimNumber: denial.payerClaimNumber }')
  );
  g.add('decide', 'std.human.task', {
    label: 'Denial Decision',
    config: {
      title: 'Denial decision',
      queue: 'billing-reconcile',
      instructions:
        'The payer denied this claim. The denial, its reason codes and the suggested decision with why are in the details. Correct the claim (a replacement or void, or a reopening where the payer takes no corrected claims), appeal it, bill another payer (choose it), move the balance to the patient, or write it off.',
      fields: DECISION_FIELDS,
      outcomes: ['correctClaim', 'appeal', 'billAnotherPayer', 'moveToPatient', 'writeOff']
    }
  });
  g.add('correctInputs', 'std.expr', {
    label: 'Correction Inputs',
    config: {
      expression:
        '{ claimId: claimId, coverageId: coverageId, correction: correction, payerClaimNumber: payerClaimNumber, subject: subject, context: context }'
    }
  });
  g.add('correct', 'std.flow.run-workflow', {
    label: 'Correct Claim',
    config: { workflow: 'billing.correct-claim', version: 1 }
  });
  g.add('corrected', 'std.flow.switch', { label: 'How It Ended', config: { cases: ['void'] } });
  g.add('appealInputs', 'std.expr', {
    label: 'Appeal Inputs',
    config: {
      expression: '{ claimId: claimId, coverageId: coverageId, subject: subject, context: context }'
    }
  });
  g.add('appeal', 'std.flow.run-workflow', {
    label: 'Appeal Claim',
    config: { workflow: 'billing.appeal-claim', version: 1 }
  });
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
    'correctInputs.claimId',
    'appealInputs.claimId',
    'addPayer.claimId',
    'otherPayer.claimId',
    'toPatient.claimId',
    'skipRest.claimId'
  );
  g.wire(
    'entry.coverageId',
    'read.coverageId',
    'correctInputs.coverageId',
    'appealInputs.coverageId',
    'otherPayer.coverageId',
    'toPatient.coverageId'
  );
  g.wire('entry.subject', 'decide.subject', 'correctInputs.subject', 'appealInputs.subject');
  g.wire('entry.context', 'details.context', 'correctInputs.context', 'appealInputs.context');
  g.wire('follow.then', 'read.exec');
  g.wire('read.then', 'choices.exec');
  g.wire('read.denial', 'category.denial', 'details.denial', 'defaults.denial');
  g.wire('category.suggestion', 'details.suggestion');
  g.wire('category.reasons', 'details.reasons');
  g.wire('details.result', 'decide.context');
  summarize(g, 'decide', DENIAL_SUMMARY, {
    denial: 'read.denial',
    suggestion: 'category.suggestion'
  });
  g.wire('defaults.result', 'decide.defaults');
  g.wire('choices.then', 'decide.exec');
  g.wire('choices.options', 'directory.object');
  g.wire('directory.object', 'decide.options');
  g.wire('decide.correctClaim', 'correct.exec');
  g.wire('decide.correction', 'correctInputs.correction');
  g.wire('decide.payerClaimNumber', 'correctInputs.payerClaimNumber');
  g.wire('correctInputs.result', 'correct.inputs');
  g.wire('correct.then', 'corrected.exec');
  g.wire('correct.pin', 'corrected.value');
  g.wire('corrected.void', 'voidReturn.exec');
  g.wire('corrected.default', 'doneReturn.exec');
  g.wire('decide.appeal', 'appeal.exec');
  g.wire('appealInputs.result', 'appeal.inputs');
  g.wire('appeal.then', 'doneReturn.exec');
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

const VOID_STALE =
  'The claim changed, or this payer is no longer the one being billed, before the void could be filed';

const correctClaim = (): GraphDef => {
  const g = graph(
    {
      execIn: ['exec'],
      execOut: ['done', 'void'],
      inputs: [
        ...claimInputs,
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
    },
    [{ name: 'whyNotFiled', type: 'string', default: null }]
  );
  g.add('read', 'billing.read-denial', { label: 'Read Denial' });
  g.add('method', 'billing.correction-method', { label: 'Replacement or Reopening' });
  g.add('route', 'std.flow.switch', {
    label: 'By Method',
    config: { cases: ['replacement', 'void', 'reopening'] }
  });
  g.add(
    'number',
    'std.expr',
    expr('Claim Number to Replace', 'coalesce(payerClaimNumber, denial.payerClaimNumber)')
  );
  recordEvent(g, 'replace', 'resubmit_queued', 'Queue the Replacement Claim');
  g.add('fix', 'billing.fix-claim', { label: 'Correct the Claim Data', values: { all: true } });
  recordEvent(g, 'reopenVoid', 'resubmit_queued', 'Reopen for the Void');
  g.add('prepare', 'billing.prepare-837p', { label: 'Prepare 837P Claim' });
  g.add('map', 'billing.map-837p', { label: 'Map 837P Claim' });
  g.add('frequency', 'billing.with-frequency', { label: 'Void Frequency' });
  g.add('file', 'billing.file-837p', { label: 'File 837P Void' });
  g.add('send', 'billing.send-837p', { label: 'Send 837P to Clearinghouse' });
  g.add('blockedWhy', 'std.var.set', {
    label: 'Why the Void Was Blocked',
    config: { name: 'whyNotFiled' }
  });
  g.add('staleWhy', 'std.var.set', {
    label: 'Why the Void Went Stale',
    config: { name: 'whyNotFiled' },
    values: { value: VOID_STALE }
  });
  g.add('why', 'std.var.get', { label: 'Why Not Filed', config: { name: 'whyNotFiled' } });
  g.add(
    'filingContext',
    'std.expr',
    expr('Filing Context', 'merge(context ?? {}, { whyNotFiled: reason })')
  );
  g.add('blocked', 'std.human.task', {
    label: 'Void Could Not Be Filed',
    config: {
      title: 'Void could not be filed',
      queue: 'billing-review',
      instructions:
        'The void (frequency 8) of this claim could not be filed for the reason in the details. Fix what it names (the billing profile is in Settings) and try again, fix the claim data and try again, skip this payer, or mark the void submitted if it went out another way. Until it is filed the payer still has the claim.',
      outcomes: ['tryAgain', 'fixData', 'skipPayer', 'submitted']
    }
  });
  g.add('fixVoid', 'billing.fix-claim', {
    label: 'Fix Claim Data for the Void',
    values: { all: true }
  });
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
      outcomes: ['requested', 'cannotReopen']
    }
  });
  g.add('reopenNote', 'std.expr', expr('Reopening Note', '"Reopening requested: " + reference'));
  recordEvent(g, 'requested', 'reopening_requested', 'Log the Reopening Request');
  g.ret('doneReturn', 'done');
  g.ret('voidReturn', 'void');
  g.wire('entry.exec', 'read.exec');
  g.wire(
    'entry.claimId',
    'read.claimId',
    'replace.claimId',
    'fix.claimId',
    'reopenVoid.claimId',
    'prepare.claimId',
    'file.claimId',
    'send.claimId',
    'fixVoid.claimId',
    'voided.claimId',
    'requested.claimId'
  );
  g.wire(
    'entry.coverageId',
    'read.coverageId',
    'replace.coverageId',
    'reopenVoid.coverageId',
    'prepare.coverageId',
    'file.coverageId',
    'voided.coverageId',
    'requested.coverageId'
  );
  g.wire('entry.subject', 'fix.subject', 'blocked.subject', 'fixVoid.subject', 'reopening.subject');
  g.wire(
    'entry.context',
    'fix.context',
    'filingContext.context',
    'fixVoid.context',
    'reopening.context'
  );
  g.wire('entry.correction', 'method.correction');
  g.wire('entry.payerClaimNumber', 'number.payerClaimNumber');
  g.wire('read.denial', 'method.denial', 'number.denial');
  g.wire('read.then', 'route.exec');
  g.wire('method.method', 'route.value');
  g.wire('number.result', 'replace.payerClaimNumber', 'reopenVoid.payerClaimNumber');
  g.wire('route.replacement', 'replace.exec');
  g.wire('replace.then', 'fix.exec');
  g.wire('fix.fixed', 'doneReturn.exec');
  g.wire('fix.backToReview', 'doneReturn.exec');
  g.wire('fix.voided', 'voidReturn.exec');
  g.wire('route.void', 'reopenVoid.exec');
  g.wire('reopenVoid.then', 'prepare.exec');
  g.wire('prepare.ready', 'file.exec');
  g.wire('prepare.stale', 'staleWhy.exec');
  g.wire('prepare.claim', 'map.claim');
  g.wire('map.x837', 'frequency.x837');
  g.wire('method.frequency', 'frequency.frequency');
  g.wire('frequency.x837', 'file.x837');
  g.wire('file.filed', 'send.exec');
  g.wire('file.controlNumber', 'send.controlNumber');
  g.wire('file.stale', 'staleWhy.exec');
  g.wire('file.blocked', 'blockedWhy.exec');
  g.wire('file.reason', 'blockedWhy.value');
  g.wire('blockedWhy.then', 'blocked.exec');
  g.wire('staleWhy.then', 'blocked.exec');
  g.wire('why.value', 'filingContext.reason');
  g.wire('filingContext.result', 'blocked.context');
  summarize(g, 'blocked', VOID_BLOCKED_SUMMARY, { context: 'entry.context', why: 'why.value' });
  summarize(g, 'reopening', REOPENING_SUMMARY, { denial: 'read.denial' });
  g.wire('blocked.tryAgain', 'prepare.exec');
  g.wire('blocked.fixData', 'fixVoid.exec');
  g.wire('fixVoid.fixed', 'prepare.exec');
  g.wire('fixVoid.backToReview', 'prepare.exec');
  g.wire('fixVoid.voided', 'voidReturn.exec');
  g.wire('blocked.skipPayer', 'voided.exec');
  g.wire('blocked.submitted', 'voided.exec');
  g.wire('send.sent', 'voided.exec');
  g.wire('send.manual', 'voided.exec');
  g.wire('voided.then', 'doneReturn.exec');
  g.wire('route.reopening', 'reopening.exec');
  g.wire('route.default', 'doneReturn.exec');
  g.wire('reopening.requested', 'requested.exec');
  g.wire('reopening.reference', 'reopenNote.reference');
  g.wire('reopenNote.result', 'requested.note');
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
  g.add('follow', 'billing.follow-claim', { label: 'Show on the Claim' });
  g.add('read', 'billing.read-denial', { label: 'Read Denial' });
  g.add('level', 'billing.appeal-level', { label: 'Appeal Level and Deadline' });
  g.add('packet', 'billing.build-appeal-packet', { label: 'Build Appeal Packet' });
  g.add(
    'details',
    'std.expr',
    expr(
      'Appeal Details',
      'merge(context ?? {}, { appeal: { level: levelName, dueOn: dueOn }, denial: denial, why: reasons })'
    )
  );
  g.add('send', 'std.human.task', {
    label: 'Send Appeal',
    config: {
      title: 'Send appeal',
      queue: 'billing-reconcile',
      instructions:
        'The appeal packet (request letter, claim summary, patient care report and the documents on the claim) is in the claim files. Add anything else that supports the claim, send it to the payer before the due date, and mark it sent. If the claim is not worth appealing, say so and decide again.',
      fields: [{ name: 'note', type: 'string', label: 'How it was sent' }],
      outcomes: ['sent', 'notAppealing']
    }
  });
  g.add(
    'sentNote',
    'std.expr',
    expr(
      'Appeal Note',
      'levelName + " sent" + (note != null && note != "" ? " (" + note + ")" : "") + ", due by " + dueOn'
    )
  );
  recordEvent(g, 'appealed', 'appealed', 'Log the Appeal');
  g.add(
    'deadline',
    'std.expr',
    expr('Decision Deadline', `addDays(now(), decisionWaitMs / ${DAY_MS})`)
  );
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
  g.add('timeLeft', 'std.expr', expr('Time Left', 'max(0, seconds) * 1000'));
  g.add('waiting', 'std.var.get', { label: 'Still Waiting', config: { name: 'waiting' } });
  g.add('loop', 'std.flow.while', { label: 'Until the Appeal Is Decided' });
  g.add('outcome', 'billing.read-appeal', { label: 'Read Appeal Outcome' });
  g.add('answered', 'std.flow.branch', { label: 'Did the Payer Answer?' });
  g.add('decision', 'billing.appeal-decision', { label: 'Appeal Decision' });
  g.add('decisionNote', 'std.expr', expr('Decision Note', 'levelName + " " + decision'));
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
      outcomes: ['keepWaiting', 'upheld', 'withdrawn']
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
  g.wire('entry.exec', 'follow.exec');
  g.wire(
    'entry.claimId',
    'follow.claimId',
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
  g.wire('entry.context', 'details.context');
  g.wire('follow.then', 'read.exec');
  g.wire('read.denial', 'level.denial', 'details.denial');
  g.wire('read.then', 'packet.exec');
  g.wire(
    'level.levelName',
    'packet.level',
    'details.levelName',
    'sentNote.levelName',
    'decisionNote.levelName'
  );
  g.wire('level.dueOn', 'packet.dueOn', 'details.dueOn', 'send.due', 'sentNote.dueOn');
  g.wire('level.reasons', 'details.reasons');
  g.wire('details.result', 'send.context', 'overdue.context');
  summarize(g, 'send', SEND_APPEAL_SUMMARY, {
    levelName: 'level.levelName',
    denial: 'read.denial',
    dueOn: 'level.dueOn'
  });
  summarize(g, 'overdue', APPEAL_OVERDUE_SUMMARY, {
    levelName: 'level.levelName',
    denial: 'read.denial'
  });
  g.wire('packet.then', 'send.exec');
  g.wire('send.notAppealing', 'doneReturn.exec');
  g.wire('send.sent', 'appealed.exec');
  g.wire('send.note', 'sentNote.note');
  g.wire('sentNote.result', 'appealed.note');
  g.wire('appealed.then', 'setDeadline.exec');
  g.wire('setDeadline.then', 'loop.exec');
  g.wire('level.decisionWaitMs', 'deadline.decisionWaitMs');
  g.wire('deadline.result', 'setDeadline.value', 'extendDeadline.value');
  g.wire('clock.now', 'untilDue.start');
  g.wire('decideBy.value', 'untilDue.end');
  g.wire('untilDue.amount', 'timeLeft.seconds');
  g.wire('overdue.keepWaiting', 'extendDeadline.exec');
  g.wire('waiting.value', 'loop.condition');
  g.wire('loop.body', 'outcome.exec');
  g.wire('loop.completed', 'doneReturn.exec');
  g.wire('outcome.then', 'answered.exec');
  g.wire('outcome.decided', 'answered.condition');
  g.wire('outcome.paidCents', 'decision.paidCents');
  g.wire('outcome.balanceCents', 'decision.balanceCents');
  g.wire('decision.decision', 'decisionNote.decision');
  g.wire('decisionNote.result', 'decided.note');
  g.wire('answered.true', 'decided.exec');
  g.wire('decided.then', 'stopDecided.exec');
  g.wire('answered.false', 'wait.exec');
  g.wire('outcome.signalsSeen', 'wait.after');
  g.wire('timeLeft.result', 'wait.timeoutMs');
  g.wire('wait.timeout', 'overdue.exec');
  g.wire('overdue.upheld', 'upheld.exec');
  g.wire('upheld.then', 'stopUpheld.exec');
  g.wire('overdue.withdrawn', 'stopWithdrawn.exec');
  g.add(
    'upheldNote',
    'std.expr',
    expr('Upheld Note', 'levelName + " upheld, as a biller recorded"')
  );
  g.wire('level.levelName', 'upheldNote.levelName');
  g.wire('upheldNote.result', 'upheld.note');
  return g.def;
};

const respondRecordsRequest = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [
      p('claimId', 'string'),
      d('coverageId', 'string', 'Payer', 'The payer asking for records, if known.', true),
      p('assignee', 'string', true)
    ],
    outputs: []
  });
  g.add('follow', 'billing.follow-claim', { label: 'Show on the Claim' });
  g.add('ledger', 'billing.read-claim-ledger', { label: 'Read Claim Ledger' });
  g.add('facts', 'billing.claim-ledger.break');
  g.add(
    'payer',
    'std.expr',
    expr('Payer Asking', 'coalesce(coverageId, unreconciledCoverageId, current)')
  );
  g.add('asking', 'billing.read-payer', { label: 'Read the Payer Asking' });
  g.add('due', 'billing.records-due', { label: 'Records Due' });
  g.add(
    'requestNote',
    'std.expr',
    expr(
      'Request Note',
      '"Records requested" + (payer != null ? " by " + payer : "") + ", due " + dueOn + (note != null && note != "" ? ": " + note : "")'
    )
  );
  recordEvent(g, 'requested', 'records_requested', 'Log the Records Request');
  g.add('subject', 'std.expr', expr('Task Subject', 'reference'));
  g.add(
    'details',
    'std.expr',
    expr('Request Details', '{ claimId: claimId, dueOn: dueOn, request: note, why: reasons }')
  );
  g.add('gather', 'std.human.task', {
    label: 'Send Records',
    config: {
      title: 'Send records',
      queue: 'billing-review',
      instructions:
        'The payer asked for records on this claim (an additional documentation request). Gather what it asks for, usually the patient care report, the physician certification, signatures and the facesheet, and send it before the due date, then mark it sent.',
      fields: [{ name: 'note', type: 'string', label: 'What was sent' }],
      outcomes: ['sent', 'cannotSend']
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
      outcomes: ['log', 'cancel']
    }
  });
  summarize(
    g,
    'log',
    "'Log the request for records a payer sent about claim ' + reference + ', with its due date'",
    { reference: 'ledger.reference' }
  );
  g.ret('done');
  g.wire('entry.exec', 'follow.exec');
  g.wire('entry.assignee', 'log.assignee');
  g.wire('subject.result', 'log.subject');
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
  g.wire('entry.coverageId', 'payer.coverageId');
  g.wire('log.dueOn', 'due.requestedDue');
  g.wire('log.note', 'requestNote.note', 'details.note');
  g.wire('follow.then', 'ledger.exec');
  g.wire('ledger.ledger', 'facts.ledger');
  g.wire('ledger.reference', 'subject.reference');
  g.wire('facts.unreconciledCoverageId', 'payer.unreconciledCoverageId');
  g.wire('facts.coverageId', 'payer.current');
  g.wire('asking.payerKind', 'due.payerKind');
  g.wire('asking.payer', 'requestNote.payer');
  g.wire('due.dueOn', 'requestNote.dueOn', 'details.dueOn', 'gather.due');
  g.wire('due.reasons', 'details.reasons');
  g.wire('payer.result', 'asking.coverageId', 'requested.coverageId', 'sent.coverageId');
  g.wire('requestNote.result', 'requested.note');
  g.wire('ledger.then', 'log.exec');
  g.wire('log.log', 'asking.exec');
  g.wire('asking.then', 'requested.exec');
  g.wire('requested.then', 'gather.exec');
  g.wire('subject.result', 'gather.subject');
  g.wire('details.result', 'gather.context');
  summarize(g, 'gather', RECORDS_SUMMARY, {
    payer: 'asking.payer',
    dueOn: 'due.dueOn',
    note: 'log.note'
  });
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
    inputs: [p('claimId', 'string'), p('subject', 'string', true), p('context', 'any', true)],
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
  g.add(
    'details',
    'std.expr',
    expr('Refund Details', 'merge(context ?? {}, { refund: refund, dueOn: dueOn, why: reasons })')
  );
  g.add('approve', 'std.human.task', {
    label: 'Approve Refund',
    config: {
      title: 'Approve refund',
      queue: 'billing-approvals',
      permission: 'claims:approve',
      instructions:
        'More has been paid on this claim than it charges. The credit balance, who paid it and the day the refund is due are in the details (Medicare and Medicaid overpayments must be returned within 60 days of being identified). Approve the refund to record it on the claim, then send it; or keep the credit.',
      fields: [{ name: 'note', type: 'string', label: 'Refund reference' }],
      outcomes: ['refund', 'keepCredit']
    }
  });
  g.add(
    'refundNote',
    'std.expr',
    expr('Refund Note', '"Refund approved" + (note != null && note != "" ? ": " + note : "")')
  );
  g.add('reread', 'billing.read-refund', { label: 'Read Credit Balance Again' });
  g.add(
    'amount',
    'std.expr',
    expr('Refund Amount', 'max(0, min(refund.overpaidCents, refund.paidCents))')
  );
  g.add('anything', 'std.expr', expr('Anything to Refund', 'amount > 0'));
  g.add('owed', 'std.flow.branch', { label: 'Still Owed?' });
  g.add('record', 'billing.record-refund', { label: 'Record Refund' });
  g.add('payer', 'std.object.get', { label: 'Who Paid', values: { path: 'coverageId' } });
  g.ret('refundedReturn', 'refunded');
  g.ret('keptReturn', 'keptCredit');
  g.wire('entry.exec', 'follow.exec');
  g.wire('entry.claimId', 'follow.claimId', 'read.claimId', 'reread.claimId', 'record.claimId');
  g.wire('entry.subject', 'approve.subject');
  g.wire('entry.context', 'details.context');
  g.wire('follow.then', 'read.exec');
  g.wire('read.refund', 'due.refund', 'details.refund');
  g.wire('due.dueOn', 'details.dueOn', 'approve.due');
  g.wire('due.reasons', 'details.reasons');
  g.wire('details.result', 'approve.context');
  summarize(g, 'approve', REFUND_SUMMARY, { refund: 'read.refund', dueOn: 'due.dueOn' });
  g.wire('read.then', 'approve.exec');
  g.wire('approve.refund', 'reread.exec');
  g.wire('reread.refund', 'amount.refund', 'payer.object');
  g.wire('amount.result', 'anything.amount', 'record.amountCents');
  g.wire('reread.then', 'owed.exec');
  g.wire('anything.result', 'owed.condition');
  g.wire('owed.true', 'record.exec');
  g.wire('owed.false', 'refundedReturn.exec');
  g.wire('approve.note', 'refundNote.note');
  g.wire('refundNote.result', 'record.note');
  g.wire('payer.value', 'record.coverageId');
  g.wire('record.then', 'refundedReturn.exec');
  g.wire('approve.keepCredit', 'keptReturn.exec');
  return g.def;
};

const approveClosing = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: ['approved', 'rejected'],
    inputs: [
      p('claimId', 'string'),
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
  const task = (id: string, title: string, instructions: string) =>
    g.add(id, 'std.human.task', {
      label: `Approve ${title}`,
      config: {
        title: `Approve ${title.toLowerCase()}`,
        queue: 'billing-approvals',
        permission: 'claims:approve',
        instructions,
        outcomes: ['approve', 'reject']
      }
    });
  task(
    'writeOff',
    'Write-Off',
    'A biller chose to write off a balance above the approval threshold of the Claim Policy. Approve the write-off to close the claim, or reject it to send it back.'
  );
  task(
    'collections',
    'Collections',
    'A biller chose to send this balance to collections, which needs approval under the Claim Policy. Approve the placement to close the claim as sent to collections, or reject it to send it back.'
  );
  g.add(
    'note',
    'std.expr',
    expr(
      'Approval Note',
      'closing == "collections" ? "Collections placement approved" : "Write-off approved"'
    )
  );
  recordEvent(g, 'approvedWriteOff', 'closing_approved', 'Log the Approval');
  recordEvent(g, 'approvedCollections', 'closing_approved', 'Log the Approval');
  g.ret('approvedReturn', 'approved');
  g.ret('rejectedReturn', 'rejected');
  g.wire('entry.exec', 'needed.exec');
  g.wire('entry.balanceCents', 'rule.balanceCents');
  g.wire('entry.thresholdCents', 'rule.thresholdCents');
  g.wire('rule.needsApproval', 'needed.condition');
  g.wire('needed.false', 'approvedReturn.exec');
  g.wire('needed.true', 'which.exec');
  g.wire('entry.closing', 'which.value', 'note.closing');
  g.wire('which.collections', 'collections.exec');
  g.wire('which.default', 'writeOff.exec');
  g.wire('entry.subject', 'writeOff.subject', 'collections.subject');
  g.wire('entry.context', 'writeOff.context', 'collections.context');
  summarize(g, 'writeOff', WRITE_OFF_SUMMARY, {
    balanceCents: 'entry.balanceCents',
    thresholdCents: 'entry.thresholdCents'
  });
  summarize(g, 'collections', COLLECTIONS_SUMMARY, { balanceCents: 'entry.balanceCents' });
  g.wire('entry.claimId', 'approvedWriteOff.claimId', 'approvedCollections.claimId');
  g.wire('note.result', 'approvedWriteOff.note', 'approvedCollections.note');
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
    'billing.denial-category',
    'Denial Category',
    'Suggests what a payer denial needs (Denial Categories table): correct the claim, appeal, bill another payer, move it to the patient or write it off, with why.',
    denialCategory()
  ),
  asRule(
    'billing.correction-method',
    'Replacement or Reopening',
    "Decides how a denied claim is corrected (Correction Methods table): a replacement claim (frequency 7) or void (frequency 8) with the payer claim number, or a reopening request where the payer takes no corrected claims (Medicare), by the payer directory's correction setting.",
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
  asWorkflow(
    'billing.correct-claim',
    'Correct Claim',
    'Corrects a denied claim the way Replacement or Reopening decides: queues a replacement claim (frequency 7 with the payer claim number, filed by the claim cycle once the data is fixed and reviewed), files a void (frequency 8) and moves on from the payer (a void that cannot be filed asks a biller to try again, fix the data and try again, skip the payer or mark it sent, and is never filed as a replacement), or asks a biller to request a reopening and waits for the payer to reprocess it. Started by Work Denial.',
    correctClaim()
  ),
  asWorkflow(
    'billing.appeal-claim',
    'Appeal Claim',
    'Appeals a denial: decides its level and due date (Appeal Level and Deadline), stores an appeal packet in the claim files, asks a biller to send it, then waits for the payer to decide (a new remittance, decided by Appeal Decision) and asks a biller when the decision is overdue, counted from when the appeal was sent however often the claim changes meanwhile. Started by Work Denial.',
    appealClaim()
  ),
  asWorkflow(
    'billing.work-denial',
    'Work Denial',
    'Works a payer denial that Remittance Routing routed to a denial, appeal or fix: suggests a decision (Denial Category) and asks a biller to correct the claim (Correct Claim), appeal it (Appeal Claim), bill another payer, move the balance to the patient or write it off. Started by the claim cycle.',
    workDenial()
  ),
  asWorkflow(
    'billing.respond-records-request',
    'Respond to Records Request',
    'Started from a claim: a Log records request task enters a payer request for records (an additional documentation request) with its due date, then logs it, decides when the records are due (Records Due) by the kind of payer asking, not the one being billed, and asks a biller to gather and send them by then.',
    respondRecordsRequest()
  ),
  asWorkflow(
    'billing.refund-overpayment',
    'Refund Overpayment',
    'Works a credit balance: reads who overpaid, decides when the refund is due (Refund Due), asks someone with the claims:approve permission to approve it, then reads the credit again and records a refund of what is still owed, never more than the credit balance or what that payer paid. Started by the claim cycle.',
    refundOverpayment()
  )
];
