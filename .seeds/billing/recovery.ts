import { CLAIM_FIX_FIELDS, CLAIM_SIGNAL } from '@ugula/billing';
import type { GraphDef, Json, ValueType } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import { beginClaimTask } from './claim-tasks.ts';
import { graph, p } from './glossary.ts';
import {
  asRule,
  asStage,
  asWorkflow,
  type Builder,
  both,
  CLAIM_DATA_DENIALS,
  codeSet,
  condition,
  d,
  either,
  exit,
  field,
  firstOf,
  fixed,
  getField,
  is,
  isListed,
  joinText,
  keepListed,
  MEDICAID_CLAIM_FILINGS,
  MEDICARE_CLAIM_FILINGS,
  makeList,
  makeObject,
  money,
  orElse,
  P,
  type Port,
  recordEvent,
  rule,
  select,
  shared,
  summary,
  T,
  table,
  template
} from './shared.ts';

const SUGGESTIONS: Record<string, string> = {
  correctClaim: 'correcting it is suggested',
  appeal: 'an appeal is suggested',
  billAnotherPayer: 'billing another payer is suggested',
  moveToPatient: 'moving the balance to the patient is suggested',
  writeOff: 'writing it off is suggested'
};

const PAYER_KIND = field('payerKind', 'string', 'Payer Kind');

const reasoned = (name: string) => {
  const fields = [
    { name, type: 'string' },
    { name: 'reason', type: 'string' }
  ] satisfies { name: string; type: ValueType }[];
  return { fields, type: { object: { [name]: 'string', reason: 'string' } } satisfies ValueType };
};

const routed = (g: Builder, id: string, label: string, route: string) =>
  condition(g, id, label, { route: ['string', 'denial.route'] }, [
    { field: 'route', op: 'is', value: route }
  ]);

const DUPLICATE_CLAIM_DENIALS = codeSet(
  'billing.duplicate-claim-denials',
  'Duplicate Claim Denials',
  'The denial reason codes (group and CARC) that mean the payer already has the claim, so Denial Category suggests correcting it.',
  { 'CO-18': 'Exact duplicate claim or service' }
);

const OTHER_PAYER_DENIALS = codeSet(
  'billing.other-payer-denials',
  'Other Payer Denials',
  'The denial reason codes (group and CARC) that mean another payer is responsible, so Denial Category suggests billing another payer.',
  {
    'CO-22': 'This care may be covered by another payer per coordination of benefits',
    'CO-23': 'The impact of prior payer adjudication, including payments and adjustments',
    'CO-24': 'Charges are covered under a capitation agreement or managed care plan',
    'CO-109': 'Not covered by this payer; send the claim to the correct payer',
    'OA-22': 'This care may be covered by another payer per coordination of benefits',
    'OA-23': 'The impact of prior payer adjudication, including payments and adjustments',
    'OA-109': 'Not covered by this payer; send the claim to the correct payer'
  }
);

const PATIENT_DENIALS = codeSet(
  'billing.patient-denials',
  'Patient Denials',
  'The denial reason codes (group and CARC) that mean the trip was not covered on the date of service or the patient is responsible, so Denial Category suggests moving the balance to the patient.',
  {
    'CO-26': 'Expenses incurred before coverage',
    'CO-27': 'Expenses incurred after coverage ended',
    'CO-31': 'The patient cannot be identified as an insured',
    'CO-177': 'The patient has not met the eligibility requirements',
    'PR-49': 'A routine or preventive service that is not covered',
    'PR-96': 'Non-covered charges',
    'PR-204': "Not covered under the patient's current benefit plan"
  }
);

const LATE_FILING_DENIALS = codeSet(
  'billing.late-filing-denials',
  'Late Filing Denials',
  "The denial reason codes (group and CARC) that mean the claim was filed after the payer's limit, so Denial Category suggests writing it off.",
  { 'CO-29': 'The time limit for filing has expired' }
);

const taskDetails = (g: Builder, label: string, fields: Record<string, [ValueType, Port]>) => {
  g.add('details', 'std.object.merge', { label: 'Task Details' });
  g.wire('entry.context', 'details.a');
  g.wire(makeObject(g, 'added', label, fields), 'details.b');
  return 'details.object' as const;
};

const breakDenial = (g: Builder, id: string, from: Port) => {
  g.add(id, 'billing.denial-facts.break', { label: 'Denial' });
  g.wire(from, `${id}.denial`);
};

const DENIAL_IN = d(
  'denial',
  T.denial,
  'Denial Facts',
  'The denial: the payer, how it was routed, its reason codes, the remittance date, the appeals so far and the payer settings.'
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

const denialCategory = (): GraphDef => {
  const g = rule(
    [DENIAL_IN],
    [
      d(
        'suggestion',
        'string',
        'Suggested Decision',
        'What the denial most likely needs, as the Denial Decision task names its choices: correctClaim, appeal, billAnotherPayer, moveToPatient or writeOff.'
      ),
      P.reasons('this decision is suggested')
    ]
  );
  breakDenial(g, 'denial', 'entry.denial');
  const anyListed = (id: string, label: string, codes: Json) => {
    keepListed(g, `${id}Codes`, `${label}: Codes`, codes, 'denial.codes');
    return condition(g, id, label, { codes: ['integer', `${id}Codes.count`] }, [
      { field: 'codes', op: 'gt', value: 0 }
    ]);
  };
  const picked = firstOf(
    g,
    'suggestion',
    'First Suggestion That Applies',
    reasoned('suggestion').type,
    [
      {
        id: 'fix',
        label: 'Correct the Claim: Routed to Fix',
        when: routed(g, 'routedToFix', 'Routed to Fix', 'fix'),
        value: fixed({
          suggestion: 'correctClaim',
          reason: 'Route Remittance found claim data to fix'
        })
      },
      {
        id: 'claimData',
        label: 'Correct the Claim: Bad Claim Data',
        when: either(
          g,
          'badData',
          'Missing, Invalid or Duplicate Claim Data',
          anyListed('claimDataCodes', 'Claim Data Denial', CLAIM_DATA_DENIALS),
          anyListed('duplicateCodes', 'Duplicate Claim Denial', DUPLICATE_CLAIM_DENIALS)
        ),
        value: fixed({
          suggestion: 'correctClaim',
          reason: 'Missing, invalid or duplicate claim data'
        })
      },
      {
        id: 'otherPayer',
        label: 'Bill Another Payer',
        when: anyListed('anotherPayer', 'Another Payer Is Responsible', OTHER_PAYER_DENIALS),
        value: fixed({ suggestion: 'billAnotherPayer', reason: 'Another payer is responsible' })
      },
      {
        id: 'patient',
        label: 'Move to the Patient',
        when: anyListed(
          'notCovered',
          'Not Covered, or the Patient Is Responsible',
          PATIENT_DENIALS
        ),
        value: fixed({
          suggestion: 'moveToPatient',
          reason: 'Not covered on the date of service, or the patient is responsible'
        })
      },
      {
        id: 'late',
        label: 'Write It Off',
        when: anyListed('filedLate', "Filed After the Payer's Limit", LATE_FILING_DENIALS),
        value: fixed({ suggestion: 'writeOff', reason: "Filed after the payer's limit" })
      },
      {
        id: 'appeal',
        label: 'Appeal: Routed to Appeal',
        when: routed(g, 'routedToAppeal', 'Routed to Appeal', 'appeal'),
        value: fixed({ suggestion: 'appeal', reason: 'Route Remittance sent it to appeal' })
      }
    ],
    fixed({
      suggestion: 'appeal',
      reason: 'No reason code points elsewhere, so an appeal is suggested'
    })
  );
  g.add('suggestionParts', 'std.object.break', {
    label: 'Suggestion and Why',
    config: { fields: reasoned('suggestion').fields }
  });
  g.wire(picked, 'suggestionParts.object');
  const value = 'suggestionParts.suggestion';
  const reasons = makeList(g, 'suggestionReasons', 'Reasons', 'string', ['suggestionParts.reason']);
  g.ret('return');
  g.wire(value, 'return.suggestion');
  g.wire(reasons, 'return.reasons');
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
        'What the biller asked for: replace to correct the claim, or void to cancel it.',
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
      d(
        'method',
        'string',
        'Method',
        'How the claim is corrected: newClaim, replacement, void or reopening.'
      ),
      d(
        'frequency',
        'string',
        'Claim Frequency',
        'The claim frequency the correction is filed with: 1 for a new claim, 7 for a replacement, 8 for a void.',
        true
      ),
      P.reasons('the claim is corrected this way')
    ]
  );
  breakDenial(g, 'denial', 'entry.denial');
  g.add('number', 'std.logic.coalesce', { label: "Entered Claim Number, Else the Payer's" });
  const never = condition(
    g,
    'neverAdjudicated',
    'The Payer Never Adjudicated the Claim',
    { payerClaimNumber: ['string', 'number.result'] },
    [{ field: 'payerClaimNumber', op: 'empty' }]
  );
  const toFix = routed(g, 'routedToFix', 'Routed to Fix', 'fix');
  const ma130 = condition(
    g,
    'ma130',
    'Returned as Unprocessable (MA130)',
    { remarkCodes: [{ list: 'string' }, 'denial.remarks'] },
    [{ field: 'remarkCodes', op: 'oneOf', value: ['MA130'] }]
  );
  const co16 = condition(
    g,
    'co16',
    'Could Not Be Processed (CO-16)',
    { reasonCodes: [{ list: 'string' }, 'denial.codes'] },
    [{ field: 'reasonCodes', op: 'oneOf', value: ['CO-16'] }]
  );
  const medicare = isListed(
    g,
    'medicare',
    'Medicare Payer',
    MEDICARE_CLAIM_FILINGS,
    'denial.payerKind'
  );
  const setting = (id: string, label: string, value: string) =>
    condition(g, id, label, { correctionMethod: ['string', 'denial.correctionMethod'] }, [
      { field: 'correctionMethod', op: 'is', value }
    ]);
  const replacements = setting('takesReplacements', 'The Payer Takes Replacements', 'replacement');
  const askedVoid = condition(
    g,
    'askedVoid',
    'The Biller Asked to Void',
    { correction: ['string', 'entry.correction'] },
    [{ field: 'correction', op: 'is', value: 'void' }]
  );
  const voidClaim = 'Void the claim the payer has on file (frequency 8)';
  const picked = firstOf(
    g,
    'method',
    'First Method That Applies',
    reasoned('method').type,
    [
      {
        id: 'resubmit',
        label: 'New Claim: Never Adjudicated',
        when: never,
        value: fixed({
          method: 'newClaim',
          reason: 'The payer never adjudicated the claim: submit it again as a new claim'
        })
      },
      {
        id: 'unprocessable',
        label: 'New Claim: Unprocessable',
        when: both(g, 'fixUnprocessable', 'Routed to Fix and Unprocessable', toFix, ma130),
        value: fixed({
          method: 'newClaim',
          reason: 'Returned as unprocessable (MA130): submit a new claim'
        })
      },
      {
        id: 'medicareUnprocessed',
        label: 'New Claim: Medicare Could Not Process It',
        when: both(
          g,
          'fixMedicareCo16',
          'Routed to Fix and Medicare Could Not Process It',
          toFix,
          both(g, 'medicareCo16', 'Medicare Could Not Process It', co16, medicare)
        ),
        value: fixed({
          method: 'newClaim',
          reason: 'Medicare could not process the claim (CO-16): submit a new claim'
        })
      },
      {
        id: 'reopenings',
        label: 'Reopening: The Payer Takes Them',
        when: setting('takesReopenings', 'The Payer Takes Reopenings', 'reopening'),
        value: fixed({
          method: 'reopening',
          reason: 'The payer takes reopening requests, not corrected claims'
        })
      },
      {
        id: 'voidReplacement',
        label: 'Void: Asked, Replacements Taken',
        when: both(
          g,
          'voidReplaced',
          'Takes Replacements and Asked to Void',
          replacements,
          askedVoid
        ),
        value: fixed({ method: 'void', reason: voidClaim })
      },
      {
        id: 'replacement',
        label: 'Replacement: The Payer Takes Them',
        when: replacements,
        value: fixed({
          method: 'replacement',
          reason: 'The payer takes replacement claims (frequency 7)'
        })
      },
      {
        id: 'medicareReopening',
        label: 'Reopening: Medicare',
        when: medicare,
        value: fixed({
          method: 'reopening',
          reason: 'Medicare corrects processed claims through reopenings (verify with the MAC)'
        })
      },
      {
        id: 'void',
        label: 'Void: Asked',
        when: askedVoid,
        value: fixed({ method: 'void', reason: voidClaim })
      }
    ],
    fixed({
      method: 'replacement',
      reason: 'Replace the claim the payer has on file (frequency 7)'
    })
  );
  g.add('methodParts', 'std.object.break', {
    label: 'Method and Why',
    config: { fields: reasoned('method').fields }
  });
  g.wire(picked, 'methodParts.object');
  const value = 'methodParts.method';
  const reasons = makeList(g, 'methodReasons', 'Reasons', 'string', ['methodParts.reason']);
  g.add('frequency', 'std.logic.choose', {
    label: 'Claim Frequency of the Method',
    config: {
      mode: 'byCase',
      type: 'string',
      cases: [{ when: 'newClaim' }, { when: 'replacement' }, { when: 'void' }]
    },
    values: { case1: '1', case2: '7', case3: '8' }
  });
  g.ret('return');
  g.wire('entry.payerClaimNumber', 'number.value');
  g.wire('denial.payerClaimNumber', 'number.fallback');
  g.wire(value, 'frequency.key', 'return.method');
  g.wire('frequency.value', 'return.frequency');
  g.wire(reasons, 'return.reasons');
  return g.def;
};

const appealLevel = (): GraphDef => {
  const g = rule(
    [DENIAL_IN],
    [
      d('levelName', 'string', 'Level Name', 'The appeal level as the packet and tasks name it.'),
      d('dueOn', 'string', 'Due On', 'The last day to send the appeal (YYYY-MM-DD).'),
      d(
        'decisionDays',
        'integer',
        'Days to Decide',
        'How many days to wait for the decision before asking a biller.'
      ),
      P.reasons('the appeal is at this level and due then')
    ]
  );
  breakDenial(g, 'denial', 'entry.denial');
  const sent = (id: string, label: string, op: string, value: number) =>
    condition(g, id, label, { appealsSent: ['integer', 'denial.appeals'] }, [
      { field: 'appealsSent', op, value }
    ]);
  const none = sent('noneSent', 'No Appeal Sent Yet', 'lte', 0);
  const medicare = isListed(
    g,
    'medicare',
    'Medicare Payer',
    MEDICARE_CLAIM_FILINGS,
    'denial.payerKind'
  );
  const medicaid = isListed(
    g,
    'medicaid',
    'Medicaid Payer',
    MEDICAID_CLAIM_FILINGS,
    'denial.payerKind'
  );
  const step = firstOf(
    g,
    'step',
    'Next Appeal',
    'string',
    [
      {
        id: 'redetermination',
        label: 'Redetermination',
        when: both(g, 'medicareFirst', "Medicare's First Appeal", medicare, none),
        value: fixed('redetermination')
      },
      {
        id: 'reconsideration',
        label: 'Reconsideration',
        when: both(
          g,
          'medicareSecond',
          "Medicare's Second Appeal",
          medicare,
          sent('atMostOne', 'At Most One Appeal Sent', 'lte', 1)
        ),
        value: fixed('reconsideration')
      },
      {
        id: 'hearing',
        label: 'ALJ Hearing',
        when: both(
          g,
          'medicareThird',
          "Medicare's Third Appeal",
          medicare,
          sent('atMostTwo', 'At Most Two Appeals Sent', 'lte', 2)
        ),
        value: fixed('hearing')
      },
      {
        id: 'council',
        label: 'Appeals Council Review',
        when: both(
          g,
          'medicareLater',
          "Medicare's Fourth Appeal or Later",
          medicare,
          sent('threeOrMore', 'Three or More Appeals Sent', 'gte', 3)
        ),
        value: fixed('council')
      },
      {
        id: 'medicaidAppeal',
        label: 'Medicaid Appeal',
        when: both(g, 'medicaidFirst', "Medicaid's First Appeal", medicaid, none),
        value: fixed('medicaid')
      },
      { id: 'firstAppeal', label: 'First Level Appeal', when: none, value: fixed('first') }
    ],
    fixed('second')
  );
  const level = (
    step: string,
    label: string,
    [levelName, days, decisionDays, payerLimit]: [string, number, number, boolean]
  ) => ({
    label,
    when: { step: is(step) },
    set: { levelName, days, decisionDays, payerLimit }
  });
  g.add('decide', 'std.table.decide', {
    label: 'Appeal Levels',
    config: shared.decision(
      'billing.appeal-levels',
      'Appeal Levels',
      "Each appeal level: its name, the days allowed to file it from the remittance and the days to wait for the decision. Where Payer Limit Applies is set, a payer's appeal limit in the payer directory replaces the days. Medicare limits: redetermination 120 days, reconsideration 180 days (42 CFR 405.942 and 405.962); the rest are defaults to verify.",
      table(
        [field('step', 'string', 'Appeal')],
        [
          field('levelName', 'string', 'Level Name'),
          field('days', 'integer', 'Days to File'),
          field('decisionDays', 'integer', 'Days to Decide'),
          field('payerLimit', 'boolean', 'Payer Limit Applies')
        ],
        [
          level('redetermination', 'Medicare: redetermination by the MAC within 120 days', [
            'Redetermination',
            120,
            60,
            false
          ]),
          level('reconsideration', 'Medicare: reconsideration by the QIC within 180 days', [
            'Reconsideration',
            180,
            60,
            false
          ]),
          level('hearing', 'Medicare: hearing before an ALJ within 60 days (verify)', [
            'ALJ Hearing',
            60,
            90,
            false
          ]),
          level(
            'council',
            'Medicare: Appeals Council review within 60 days of the ALJ decision (verify)',
            ['Appeals Council Review', 60, 90, false]
          ),
          level('medicaid', 'Medicaid: appeal within 90 days (verify with the state)', [
            'Medicaid Appeal',
            90,
            90,
            true
          ]),
          level('first', 'First appeal to the payer within 180 days (verify)', [
            'First Level Appeal',
            180,
            30,
            true
          ]),
          level('second', 'Second appeal to the payer within 60 days (verify)', [
            'Second Level Appeal',
            60,
            30,
            true
          ])
        ]
      )
    )
  });
  g.add('directoryDays', 'std.logic.coalesce', { label: 'Payer Directory Days, Else the Table' });
  const days = select(
    g,
    'days',
    'Days Allowed',
    'decide.payerLimit',
    'directoryDays.result',
    'decide.days'
  );
  g.add('dueOn', 'billing.due-after-days', { label: 'Due Date' });
  g.add('byDirectory', 'std.logic.equal', { label: 'Days Are the Payer Directory Limit' });
  const directoryText = template(
    g,
    'directoryText',
    'Payer Directory Reason',
    'The payer directory allows {days} days',
    { days: 'denial.appealDays' }
  );
  const directoryReason = select(
    g,
    'directoryReason',
    'Payer Directory Reason, If Used',
    'byDirectory.result',
    directoryText
  );
  const directoryReasons = makeList(g, 'directoryReasons', 'Payer Directory Reasons', 'string', [
    directoryReason
  ]);
  g.add('reasons', 'std.list.join', { label: 'Why', config: { count: 2, type: 'string' } });
  g.ret('return');
  g.wire(step, 'decide.step');
  g.wire('denial.appealDays', 'directoryDays.value', 'byDirectory.b');
  g.wire('decide.days', 'directoryDays.fallback');
  g.wire(days, 'dueOn.days', 'byDirectory.a');
  g.wire('denial.deniedOn', 'dueOn.from');
  g.wire('decide.reasons', 'reasons.list1');
  g.wire(directoryReasons, 'reasons.list2');
  g.wire('decide.levelName', 'return.levelName');
  g.wire('decide.decisionDays', 'return.decisionDays');
  g.wire('dueOn.dueOn', 'return.dueOn');
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
  orElse(g, 'start', 'From, Else Today', 'entry.from', 'now.now', 'datetime');
  g.add('later', 'std.time.add', { label: 'Days Later', config: { unit: 'days' } });
  g.add('day', 'std.time.parts', { label: 'Due Day' });
  g.ret('return');
  g.wire('start.value', 'later.time');
  g.wire('entry.days', 'later.amount');
  g.wire('later.time', 'day.time');
  g.wire('day.date', 'return.dueOn');
  return g.def;
};

const timeLeft = (): GraphDef => {
  const g = rule(
    [d('until', 'datetime', 'Until', 'The moment the wait ends.', true)],
    [d('leftMs', 'integer', 'Milliseconds Left', 'How long is left until then, or 0 once past.')]
  );
  g.add('now', 'std.time.now', { label: 'Now' });
  g.add('untilDue', 'std.time.difference', {
    label: 'Seconds Until Then',
    config: { unit: 'seconds' }
  });
  g.add('secondsLeft', 'std.math.max', { label: 'Seconds Left', values: { b: 0 } });
  g.add('leftMs', 'std.math.multiply', { label: 'Milliseconds Left', values: { b: 1000 } });
  g.ret('return');
  g.wire('now.now', 'untilDue.start');
  g.wire('entry.until', 'untilDue.end');
  g.wire('untilDue.amount', 'secondsLeft.a');
  g.wire('secondsLeft.result', 'leftMs.a');
  g.wire('leftMs.result', 'return.leftMs');
  return g.def;
};

const appealDecision = (): GraphDef => {
  const g = rule(
    [
      d('paidCents', 'integer', 'Paid', 'What the payer paid after the appeal (cents).'),
      d('balanceCents', 'integer', 'Balance', 'The balance left (cents).')
    ],
    [
      d('decision', 'string', 'Decision', 'What the payer decided: overturned, partial or upheld.'),
      P.reasons('the appeal was decided this way')
    ]
  );
  const paid = condition(
    g,
    'paid',
    'The Payer Paid Something',
    { paidCents: ['integer', 'entry.paidCents'] },
    [{ field: 'paidCents', op: 'gt', value: 0 }]
  );
  const settled = condition(
    g,
    'settled',
    'Nothing Is Owed',
    { balanceCents: ['integer', 'entry.balanceCents'] },
    [{ field: 'balanceCents', op: 'lte', value: 0 }]
  );
  const picked = firstOf(
    g,
    'decision',
    'First Decision That Applies',
    reasoned('decision').type,
    [
      {
        id: 'overturned',
        label: 'Overturned',
        when: both(g, 'paidInFull', 'Paid and Nothing Owed', paid, settled),
        value: fixed({ decision: 'overturned', reason: 'The payer paid the claim' })
      },
      {
        id: 'partial',
        label: 'Partly Overturned',
        when: paid,
        value: fixed({ decision: 'partial', reason: 'The payer paid part of the claim' })
      }
    ],
    fixed({ decision: 'upheld', reason: 'The payer paid nothing after the appeal' })
  );
  g.add('decisionParts', 'std.object.break', {
    label: 'Decision and Why',
    config: { fields: reasoned('decision').fields }
  });
  g.wire(picked, 'decisionParts.object');
  const value = 'decisionParts.decision';
  const reasons = makeList(g, 'decisionReasons', 'Reasons', 'string', ['decisionParts.reason']);
  g.ret('return');
  g.wire(value, 'return.decision');
  g.wire(reasons, 'return.reasons');
  return g.def;
};

const REFUND_IN = d(
  'refund',
  T.refund,
  'Refund Facts',
  'The credit balance, who paid last and when it appeared.'
);

const refundDue = (): GraphDef => {
  const g = rule(
    [REFUND_IN],
    [
      d('dueOn', 'string', 'Due On', 'The last day to refund the credit (YYYY-MM-DD).'),
      P.reasons('it is due then')
    ]
  );
  g.add('facts', 'billing.refund-facts.break', { label: 'Credit Balance' });
  g.add('decide', 'std.table.decide', {
    label: 'Refund Deadlines',
    config: shared.decision(
      'billing.refund-deadlines',
      'Refund Deadlines',
      'The days allowed to return a credit balance from the day it appeared, by who overpaid: Medicare or Medicaid (a claim filing indicator in Medicare Claim Filings or Medicaid Claim Filings), or the patient. Medicare and Medicaid overpayments are returned within 60 days of being identified (42 CFR 401.305; verify Medicaid by state).',
      table(
        [field('government', 'boolean', 'Medicare or Medicaid'), PAYER_KIND],
        [field('days', 'integer', 'Days Allowed')],
        [
          {
            label: 'Medicare and Medicaid overpayments are returned within 60 days',
            when: { government: is(true) },
            set: { days: 60 }
          },
          {
            label: 'Patient credit balances are refunded within 30 days',
            when: { payerKind: is('patient') },
            set: { days: 30 }
          }
        ],
        { days: 60 },
        'Due 60 days after it was found'
      )
    )
  });
  g.add('dueOn', 'billing.due-after-days', { label: 'Due Date' });
  g.ret('return');
  g.wire('entry.refund', 'facts.refund');
  g.wire('facts.payerKind', 'decide.payerKind');
  g.wire(
    either(
      g,
      'government',
      'Medicare or Medicaid Overpaid',
      isListed(g, 'medicare', 'Medicare Overpaid', MEDICARE_CLAIM_FILINGS, 'facts.payerKind'),
      isListed(g, 'medicaid', 'Medicaid Overpaid', MEDICAID_CLAIM_FILINGS, 'facts.payerKind')
    ),
    'decide.government'
  );
  g.wire('facts.identifiedOn', 'dueOn.from');
  g.wire('decide.days', 'dueOn.days');
  g.wire('dueOn.dueOn', 'return.dueOn');
  g.wire('decide.reasons', 'return.reasons');
  return g.def;
};

const refundAmount = (): GraphDef => {
  const g = rule(
    [REFUND_IN],
    [
      d(
        'amountCents',
        'integer',
        'Refund Amount',
        'What to refund (cents): the credit, but never more than that payer or the patient paid.'
      ),
      d(
        'coverageId',
        { id: 'coverage' },
        'Refund To',
        'The payer on the claim the refund goes to, or nothing for the patient.',
        true
      ),
      d('owed', 'boolean', 'Anything to Refund', 'Whether there is anything left to refund.')
    ]
  );
  g.add('credit', 'billing.refund-facts.break', { label: 'Credit Balance' });
  g.add('smaller', 'std.math.min', { label: 'Credit or What Was Paid' });
  g.add('amount', 'std.math.max', { label: 'Refund Amount', values: { b: 0 } });
  const owed = condition(
    g,
    'owed',
    'Something to Refund',
    { amount: ['integer', 'amount.result'] },
    [{ field: 'amount', op: 'gt', value: 0 }]
  );
  g.ret('return');
  g.wire('entry.refund', 'credit.refund');
  g.wire('credit.overpaidCents', 'smaller.a');
  g.wire('credit.paidCents', 'smaller.b');
  g.wire('smaller.result', 'amount.a');
  g.wire('amount.result', 'return.amountCents');
  g.wire('credit.coverageId', 'return.coverageId');
  g.wire(owed, 'return.owed');
  return g.def;
};

const refundSummary = (): GraphDef => {
  const g = rule(
    [
      REFUND_IN,
      d('dueOn', 'string', 'Due On', 'The last day to refund the credit (YYYY-MM-DD).', true)
    ],
    [d('summary', 'string', 'Summary', 'Who overpaid, by how much, and when the refund is due.')]
  );
  g.add('facts', 'billing.refund-facts.break', { label: 'Credit Balance' });
  const payer = orElse(g, 'payer', 'Payer, Else the Patient', 'facts.payer', fixed('The patient'));
  const overpaid = money(g, 'overpaid', 'Overpaid', 'facts.overpaidCents');
  const paidMore = template(
    g,
    'paidMore',
    'Paid More Than Charged',
    '[paid {overpaid} more than this claim charges]',
    { overpaid }
  );
  const paid = orElse(
    g,
    'paid',
    'Paid More, Else Overpaid',
    paidMore,
    fixed('overpaid this claim')
  );
  const text = template(
    g,
    'text',
    'Summary',
    '{payer} {paid}; refund it[ by {dueOn}] or keep the credit',
    { payer, paid, dueOn: 'entry.dueOn' }
  );
  g.ret('return');
  g.wire('entry.refund', 'facts.refund');
  g.wire(text, 'return.summary');
  return g.def;
};

const recordsDue = (): GraphDef => {
  const g = rule(
    [
      d(
        'payerKind',
        'string',
        'Payer Kind',
        'The claim filing indicator of the payer asking, or patient.'
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
      'The days allowed to answer a records request (an additional documentation request) that names no due date, by whether the payer is Medicare (a claim filing indicator in Medicare Claim Filings). Medicare allows 45 days (verify with the MAC); the others are defaults.',
      table(
        [field('medicare', 'boolean', 'Medicare Payer')],
        [field('days', 'integer', 'Days Allowed')],
        [
          {
            label: 'Medicare additional documentation requests allow 45 days (verify)',
            when: { medicare: is(true) },
            set: { days: 45 }
          }
        ],
        { days: 30 },
        'Records are due 30 days after the request'
      )
    )
  });
  g.add('allowed', 'billing.due-after-days', { label: 'Due After the Days Allowed' });
  orElse(
    g,
    'dueOn',
    'Requested Due Date, Else the Days Allowed',
    'entry.requestedDue',
    'allowed.dueOn'
  );
  const requested = condition(
    g,
    'requested',
    'The Request Names a Due Date',
    { requestedDue: ['string', 'entry.requestedDue'] },
    [{ field: 'requestedDue', op: 'present' }]
  );
  const reasons = select(
    g,
    'reasons',
    'Why',
    requested,
    fixed(['The request names its due date']),
    'decide.reasons'
  );
  g.ret('return');
  g.wire(
    isListed(g, 'medicare', 'Medicare Payer', MEDICARE_CLAIM_FILINGS, 'entry.payerKind'),
    'decide.medicare'
  );
  g.wire('decide.days', 'allowed.days');
  g.wire('dueOn.value', 'return.dueOn');
  g.wire(reasons, 'return.reasons');
  return g.def;
};

const BALANCE = d(
  'balanceCents',
  'integer',
  'Balance',
  'The balance the claim would close with (cents).'
);

const THRESHOLD = d(
  'thresholdCents',
  'integer',
  'Approval Threshold',
  'The largest balance closed without approval (cents), from the Claim Policy table.'
);

const payerResponseAmounts = (): GraphDef => {
  const g = rule(
    [
      d('paidCents', 'integer', 'Paid', 'What the payer paid in all (cents).'),
      d('adjustments', T.adjustments, 'Adjustments', 'Every adjustment the payer sent.')
    ],
    [
      d('allowedCents', 'integer', 'Allowed', 'What the payer allowed (cents).'),
      d(
        'reasonCoded',
        'boolean',
        'Sent Reason Codes',
        'Whether the payer sent any adjustments at all.'
      )
    ]
  );
  const total = (id: string, label: string, group: string, codes: Json) => {
    g.add(`${id}Group`, 'std.list.where', {
      label: `Group ${group} Adjustments`,
      config: { field: 'group', op: 'is', value: group }
    });
    keepListed(g, id, label, codes, `${id}Group.list`, 'reason');
    g.add(`${id}Cents`, 'std.list.pluck', {
      label: `${label}, Each Amount`,
      values: { field: 'cents' }
    });
    g.add(`${id}Total`, 'std.math.sum', { label: `${label}, in All` });
    g.wire('entry.adjustments', `${id}Group.list`);
    g.wire(`${id}.list`, `${id}Cents.list`);
    g.wire(`${id}Cents.list`, `${id}Total.values`);
    return `${id}Total.result` as const;
  };
  const costShare = shared.lookup(
    'billing.cost-share-codes',
    'Cost Share Codes',
    "The reason codes (CARC) that, in the patient responsibility group (PR), state the patient's share of what a payer allowed, so Payer Response Amounts adds them to what it paid: deductible, coinsurance and copay.",
    {
      type: 'string',
      rows: [
        { key: '1', value: 'Deductible' },
        { key: '2', value: 'Coinsurance' },
        { key: '3', value: 'Copay' }
      ]
    }
  );
  const sequestration = shared.lookup(
    'billing.sequestration-codes',
    'Sequestration Codes',
    'The reason codes (CARC) that, in the contractual obligation group (CO), take Medicare sequestration off a payment, so Payer Response Amounts counts them as allowed.',
    { type: 'string', rows: [{ key: '253', value: 'Sequestration' }] }
  );
  g.add('paidAndShare', 'std.math.add', { label: 'Paid Plus Cost Share' });
  g.add('allowed', 'std.math.add', { label: 'Plus Sequestration' });
  const coded = condition(
    g,
    'coded',
    'Sent Any Adjustments',
    { adjustments: [T.adjustments, 'entry.adjustments'] },
    [{ field: 'adjustments', op: 'present' }]
  );
  g.ret('return');
  g.wire('entry.paidCents', 'paidAndShare.a');
  g.wire(total('costShare', 'Cost Share', 'PR', costShare), 'paidAndShare.b');
  g.wire('paidAndShare.result', 'allowed.a');
  g.wire(total('sequestration', 'Sequestration', 'CO', sequestration), 'allowed.b');
  g.wire('allowed.result', 'return.allowedCents');
  g.wire(coded, 'return.reasonCoded');
  return g.def;
};

const patientResponsibility = (): GraphDef => {
  const g = rule(
    [
      d(
        'patientBalance',
        T.patientBalance,
        'Patient Balance Facts',
        'The balance, the adjustments the last payer that answered sent, the claim filing indicators of the payers on the claim, the state, the date of service and the plan type.'
      )
    ],
    [
      d(
        'protection',
        'string',
        'Protection',
        'What the law protects: none, cap (the in-network cost share only) or block (no balance billing).'
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
  g.add('facts', 'billing.patient-balance-facts.break', { label: 'Patient Balance' });
  const onClaim = (id: string, label: string, lookup: Json) => {
    keepListed(g, id, `${label} Payers on the Claim`, lookup, 'facts.claimFilings');
    return `${id}.count` as const;
  };
  const dual = condition(
    g,
    'dual',
    'Medicare and Medicaid Both on the Claim',
    {
      medicare: ['integer', onClaim('medicarePayers', 'Medicare', MEDICARE_CLAIM_FILINGS)],
      medicaid: ['integer', onClaim('medicaidPayers', 'Medicaid', MEDICAID_CLAIM_FILINGS)]
    },
    [
      { field: 'medicare', op: 'gte', value: 1 },
      { field: 'medicaid', op: 'gte', value: 1 }
    ]
  );
  const stateLaw = (state: string, name: string, from: string) => ({
    id: state.toLowerCase(),
    label: `Cap: ${name} Law`,
    when: condition(
      g,
      `${state.toLowerCase()}Law`,
      `${name} Law Applies`,
      {
        pickupState: ['string', 'facts.state'],
        planType: ['string', 'facts.planType'],
        serviceDate: ['string', 'facts.serviceDate']
      },
      [
        { field: 'pickupState', op: 'is', value: state },
        { field: 'planType', op: 'is', value: 'fully_insured' },
        { field: 'serviceDate', op: 'gte', value: from }
      ]
    ),
    value: fixed({
      protection: 'cap',
      reason: `${name}: ground ambulance balance billing limited to in-network cost share for fully insured plans from ${from} (verify)`
    })
  });
  const picked = firstOf(
    g,
    'protection',
    'First Protection That Applies',
    reasoned('protection').type,
    [
      {
        id: 'dualEligible',
        label: 'Block: Dual Eligible',
        when: dual,
        value: fixed({
          protection: 'block',
          reason:
            'Medicare and Medicaid are both on the claim: a QMB or Medicaid enrollee owes no Medicare cost sharing (SSA 1902(n)(3)(B))'
        })
      },
      {
        id: 'medicaidLast',
        label: 'Cap: Medicaid Paid Last',
        when: isListed(
          g,
          'medicaid',
          'Medicaid Paid Last',
          MEDICAID_CLAIM_FILINGS,
          'facts.payerKind'
        ),
        value: fixed({
          protection: 'cap',
          reason:
            'Medicaid payment is payment in full: the patient owes only the cost share Medicaid stated (42 CFR 447.15)'
        })
      },
      {
        id: 'medicareLast',
        label: 'Cap: Medicare Paid Last',
        when: isListed(
          g,
          'medicare',
          'Medicare Paid Last',
          MEDICARE_CLAIM_FILINGS,
          'facts.payerKind'
        ),
        value: fixed({
          protection: 'cap',
          reason:
            'Medicare ambulance claims take assignment: the patient owes the deductible and coinsurance only'
        })
      },
      {
        id: 'erisa',
        label: 'None: Self-Funded Plan',
        when: condition(
          g,
          'selfFunded',
          'Self-Funded Plan',
          { planType: ['string', 'facts.planType'] },
          [{ field: 'planType', op: 'is', value: 'self_funded' }]
        ),
        value: fixed({
          protection: 'none',
          reason: 'Self-funded (ERISA) plans are outside state balance-billing laws'
        })
      },
      stateLaw('NH', 'New Hampshire', '2026-01-01'),
      stateLaw('OR', 'Oregon', '2026-01-01'),
      stateLaw('AL', 'Alabama', '2026-10-01')
    ],
    fixed({ protection: 'none', reason: 'No balance-billing protection applies' })
  );
  g.add('protectionParts', 'std.object.break', {
    label: 'Protection and Why',
    config: { fields: reasoned('protection').fields }
  });
  g.wire(picked, 'protectionParts.object');
  const value = 'protectionParts.protection';
  const reasons = makeList(g, 'protectionReasons', 'Reasons', 'string', ['protectionParts.reason']);
  g.add('patientShare', 'std.list.where', {
    label: 'Patient Responsibility Adjustments',
    config: { field: 'group', op: 'is', value: 'PR' }
  });
  g.add('shareCents', 'std.list.pluck', { label: 'Amount of Each', values: { field: 'cents' } });
  g.add('costShare', 'std.math.sum', { label: 'Cost Share the Payer Stated' });
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
  g.wire('facts.adjustments', 'patientShare.list');
  g.wire('patientShare.list', 'shareCents.list');
  g.wire('shareCents.list', 'costShare.values');
  g.wire(value, 'excess.key', 'return.protection');
  g.wire('facts.balanceCents', 'wholeBalance.a', 'beyondShare.a', 'left.a');
  g.wire('costShare.result', 'beyondShare.b');
  g.wire('beyondShare.result', 'beyondShareOwed.a');
  g.wire('wholeBalance.result', 'excess.case1');
  g.wire('beyondShareOwed.result', 'excess.case2');
  g.wire('excess.value', 'left.b', 'return.excessCents');
  g.wire('left.result', 'owed.a');
  g.wire('owed.result', 'return.responsibilityCents');
  g.wire(reasons, 'return.reasons');
  return g.def;
};

const denialSummary = (): GraphDef => {
  const g = rule(
    [
      DENIAL_IN,
      d(
        'suggestion',
        'string',
        'Suggested Decision',
        'What Denial Category suggests, such as appeal.',
        true
      )
    ],
    [
      d(
        'summary',
        'string',
        'Summary',
        'Who denied the claim, with which reason codes, the balance left open and what is suggested.'
      )
    ]
  );
  breakDenial(g, 'denial', 'entry.denial');
  const payer = orElse(g, 'payer', 'Payer, Else the Payer', 'denial.payer', fixed('The payer'));
  const codes = joinText(g, 'codes', 'Reason Codes', ', ', 'denial.codes');
  const owes = condition(
    g,
    'owes',
    'A Balance Is Left',
    { balanceCents: ['integer', 'denial.balanceCents'] },
    [{ field: 'balanceCents', op: 'gt', value: 0 }]
  );
  const balance = select(
    g,
    'leaving',
    'Balance Left Open',
    owes,
    money(g, 'balance', 'Balance', 'denial.balanceCents')
  );
  g.add('suggested', 'std.logic.choose', {
    label: 'Suggested Decision in Words',
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
  const text = template(
    g,
    'text',
    'Summary',
    '{payer} denied this claim[ ({codes})][, leaving {balance} open]; {suggested}',
    { payer, codes, balance, suggested: 'suggested.value' }
  );
  g.ret('return');
  g.wire('entry.suggestion', 'suggested.key');
  g.wire(text, 'return.summary');
  return g.def;
};

const appealSummaries = (): GraphDef => {
  const g = rule(
    [
      DENIAL_IN,
      d('levelName', 'string', 'Level Name', 'The appeal level as tasks name it.', true),
      d('dueOn', 'string', 'Due On', 'The last day to send the appeal (YYYY-MM-DD).', true)
    ],
    [
      d(
        'send',
        'string',
        'Send Summary',
        'What the Send Appeal task asks: the level, the payer, the denial codes and the due date.'
      ),
      d(
        'overdue',
        'string',
        'Overdue Summary',
        'What the Appeal Decision Overdue task says when the payer has not decided in time.'
      )
    ]
  );
  breakDenial(g, 'denial', 'entry.denial');
  g.add('level', 'std.text.lower', { label: 'Level in Words' });
  const named = orElse(
    g,
    'levelName',
    'Level Name, Else Appeal',
    'entry.levelName',
    fixed('appeal')
  );
  const payer = orElse(g, 'payer', 'Payer, Else the Payer', 'denial.payer', fixed('the payer'));
  g.add('deniedBy', 'std.text.capitalize', { label: 'Payer to Open the Summary' });
  g.add('codes', 'std.text.join', {
    label: 'Reason Codes',
    values: { separator: ', ', last: ' and ' }
  });
  const send = template(
    g,
    'send',
    'Send Summary',
    'Send the {level} to {payer}[ against its {codes} denial][ by {dueOn}]; the packet is in the claim files',
    { level: 'level.result', payer, codes: 'codes.text', dueOn: 'entry.dueOn' }
  );
  const overdue = template(
    g,
    'overdue',
    'Overdue Summary',
    '{payer} has not decided the {level} in time; check its status, then keep waiting, record it upheld or withdraw it',
    { payer: 'deniedBy.result', level: 'level.result' }
  );
  g.ret('return');
  g.wire(named, 'level.text');
  g.wire(payer, 'deniedBy.text');
  g.wire('denial.codes', 'codes.items');
  g.wire(send, 'return.send');
  g.wire(overdue, 'return.overdue');
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
  const details = taskDetails(g, 'Denial and Suggestion', {
    denial: [T.denial, 'read.denial'],
    suggested: ['string', 'category.suggestion'],
    why: [{ list: 'string' }, 'category.reasons']
  });
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
  const number = getField(
    g,
    'number',
    'Payer Claim Number',
    T.denial,
    'payerClaimNumber',
    'read.denial'
  );
  g.add('decideSummary', 'billing.denial-summary', { label: 'Task Summary' });
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
  g.wire('read.denial', 'category.denial', 'decideSummary.denial');
  g.wire('category.suggestion', 'decideSummary.suggestion');
  g.wire('decideSummary.summary', 'decide.summary');
  g.wire(details, 'decide.context');
  g.wire(number, 'defaults.payerClaimNumber');
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
      d('correction', 'string', 'Correction', 'What the biller asked for: replace or void.', true),
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
  g.add('read', 'billing.read-denial', { label: 'Read Denial' });
  g.add('method', 'billing.correction-method', { label: 'Correction Method' });
  g.add('route', 'std.flow.switch', {
    label: 'By Method',
    config: { cases: ['newClaim', 'replacement', 'void', 'reopening'] }
  });
  breakDenial(g, 'facts', 'read.denial');
  g.add('number', 'std.logic.coalesce', { label: "Entered Claim Number, Else the Payer's" });
  const payer = orElse(g, 'payer', 'Payer, Else the Payer', 'facts.payer', fixed('the payer'));
  recordEvent(g, 'replace', 'resubmit_queued', 'Queue the Replacement Claim');
  recordEvent(g, 'newClaim', 'resubmit_queued', 'Queue a New Claim');
  g.add('fix', 'billing.fix-claim', { label: 'Correct the Claim Data', values: { all: true } });
  recordEvent(g, 'reopenVoid', 'resubmit_queued', 'Reopen for the Void');
  g.add('submit', 'billing.submit-to-payer', { label: 'Submit the Void' });
  recordEvent(g, 'voided', 'payer_skipped', 'Move On from the Voided Payer');
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
  const note = template(g, 'reopenNote', 'Reopening Note', 'Reopening requested: {reference}', {
    reference: 'reopening.reference'
  });
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
  g.wire('read.denial', 'method.denial');
  g.wire('facts.payerClaimNumber', 'number.fallback');
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
    { payer, number: 'facts.payerClaimNumber' }
  );
  g.wire('reopening.requested', 'requested.exec');
  g.wire(note, 'requested.note');
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
  const appeal = makeObject(g, 'appealAt', 'Appeal Level and Due Date', {
    level: ['string', 'level.levelName'],
    dueOn: ['string', 'level.dueOn']
  });
  const details = taskDetails(g, 'Appeal and Denial', {
    appeal: [{ object: { level: 'string', dueOn: 'string' } }, appeal],
    denial: [T.denial, 'read.denial'],
    why: [{ list: 'string' }, 'level.reasons']
  });
  g.add('summaries', 'billing.appeal-summaries', { label: 'Task Summaries' });
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
  const sentNote = template(
    g,
    'sentNote',
    'Appeal Note',
    '{levelName} sent[ ({note})], due by {dueOn}',
    { levelName: 'level.levelName', note: 'send.note', dueOn: 'level.dueOn' }
  );
  recordEvent(g, 'appealed', 'appealed', 'Log the Appeal');
  g.add('clock', 'std.time.now', { label: 'Now' });
  g.add('deadline', 'std.time.add', { label: 'Decision Deadline', config: { unit: 'days' } });
  g.add('setDeadline', 'std.var.set', {
    label: 'Remember the Decision Deadline',
    config: { name: 'decideBy' }
  });
  g.add('extendDeadline', 'std.var.set', {
    label: 'Wait Another Period',
    config: { name: 'decideBy' }
  });
  g.add('decideBy', 'std.var.get', { label: 'Decision Due', config: { name: 'decideBy' } });
  g.add('timeLeft', 'billing.time-left', { label: 'Time Left to Decide' });
  g.add('waiting', 'std.var.get', { label: 'Still Waiting', config: { name: 'waiting' } });
  g.add('loop', 'std.flow.while', { label: 'Until the Appeal Is Decided' });
  g.add('outcome', 'billing.read-appeal', { label: 'Read Appeal Outcome' });
  g.add('answered', 'std.flow.branch', { label: 'Did the Payer Answer?' });
  g.add('decision', 'billing.appeal-decision', { label: 'Appeal Decision' });
  const decisionNote = template(g, 'decisionNote', 'Decision Note', '{levelName} {decision}', {
    levelName: 'level.levelName',
    decision: 'decision.decision'
  });
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
  const upheldNote = template(
    g,
    'upheldNote',
    'Upheld Note',
    '{levelName} upheld, as a biller recorded',
    { levelName: 'level.levelName' }
  );
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
  g.wire('read.denial', 'level.denial', 'summaries.denial');
  g.wire('read.then', 'packet.exec');
  g.wire('level.levelName', 'packet.level', 'summaries.levelName');
  g.wire('level.dueOn', 'packet.dueOn', 'send.due', 'summaries.dueOn');
  g.wire(details, 'send.context', 'overdue.context');
  g.wire('summaries.send', 'send.summary');
  g.wire('summaries.overdue', 'overdue.summary');
  g.wire('packet.then', 'send.exec');
  g.wire('send.notAppealing', 'doneReturn.exec');
  g.wire('send.sent', 'appealed.exec');
  g.wire(sentNote, 'appealed.note');
  g.wire('appealed.then', 'setDeadline.exec');
  g.wire('setDeadline.then', 'loop.exec');
  g.wire('clock.now', 'deadline.time');
  g.wire('level.decisionDays', 'deadline.amount');
  g.wire('deadline.time', 'setDeadline.value', 'extendDeadline.value');
  g.wire('decideBy.value', 'timeLeft.until');
  g.wire('overdue.keepWaiting', 'extendDeadline.exec');
  g.wire('waiting.value', 'loop.condition');
  g.wire('loop.body', 'outcome.exec');
  g.wire('loop.completed', 'doneReturn.exec');
  g.wire('outcome.then', 'answered.exec');
  g.wire('outcome.decided', 'answered.condition');
  g.wire('outcome.paidCents', 'decision.paidCents');
  g.wire('outcome.balanceCents', 'decision.balanceCents');
  g.wire(decisionNote, 'decided.note');
  g.wire('answered.true', 'decided.exec');
  g.wire('decided.then', 'stopDecided.exec');
  g.wire('answered.false', 'wait.exec');
  g.wire('outcome.signalsSeen', 'wait.after');
  g.wire('timeLeft.leftMs', 'wait.timeoutMs');
  g.wire('wait.timeout', 'overdue.exec');
  g.wire('overdue.upheld', 'upheld.exec');
  g.wire(upheldNote, 'upheld.note');
  g.wire('upheld.then', 'stopUpheld.exec');
  g.wire('overdue.withdrawn', 'stopWithdrawn.exec');
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
  beginClaimTask(g);
  g.add('facts', 'billing.claim-ledger.break', { label: 'Claim Ledger' });
  g.add('payer', 'std.logic.choose', {
    label: 'Payer Asking',
    config: { mode: 'first', type: { id: 'coverage' }, count: 3 }
  });
  g.add('asking', 'billing.read-payer', { label: 'Read the Payer Asking' });
  g.add('due', 'billing.records-due', { label: 'Records Due' });
  const requestNote = template(
    g,
    'requestNote',
    'Request Note',
    'Records requested[ by {payer}], due {dueOn}[: {note}]',
    { payer: 'asking.payer', dueOn: 'due.dueOn', note: 'log.note' }
  );
  recordEvent(g, 'requested', 'records_requested', 'Log the Records Request');
  const details = makeObject(g, 'details', 'Request Details', {
    claimId: [{ id: 'claim' }, 'entry.claimId'],
    dueOn: ['string', 'due.dueOn'],
    request: ['string', 'log.note'],
    why: [{ list: 'string' }, 'due.reasons']
  });
  const payerName = orElse(
    g,
    'payerName',
    'Payer, Else the Payer',
    'asking.payer',
    fixed('The payer')
  );
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
  g.wire(
    template(
      g,
      'logSummary',
      'Log Request Summary',
      'Log the request for records a payer sent about claim {reference}, with its due date',
      { reference: 'ledger.reference' }
    ),
    'log.summary'
  );
  g.ret('done');
  g.wire('entry.assignee', 'log.assignee');
  g.wire('log.cancel', 'done.exec');
  g.wire('entry.claimId', 'asking.claimId', 'requested.claimId', 'sent.claimId');
  g.wire('entry.coverageId', 'payer.option1');
  g.wire('log.dueOn', 'due.requestedDue');
  g.wire('ledger.ledger', 'facts.ledger');
  g.wire('ledger.reference', 'log.subject', 'gather.subject');
  g.wire('facts.unreconciledCoverageId', 'payer.option2');
  g.wire('facts.coverageId', 'payer.option3');
  g.wire('asking.payerKind', 'due.payerKind');
  g.wire('due.dueOn', 'gather.due');
  g.wire('payer.value', 'asking.coverageId', 'requested.coverageId', 'sent.coverageId');
  g.wire(requestNote, 'requested.note');
  g.wire('ledger.then', 'log.exec');
  g.wire('log.log', 'asking.exec');
  g.wire('asking.then', 'requested.exec');
  g.wire('requested.then', 'gather.exec');
  g.wire(details, 'gather.context');
  g.wire(
    template(
      g,
      'gatherSummary',
      'Send Records Summary',
      '{payer} asked for records on this claim[, due {dueOn}][ ({note})]; send them and mark it sent',
      { payer: payerName, dueOn: 'due.dueOn', note: 'log.note' }
    ),
    'gather.summary'
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
  const details = taskDetails(g, 'Refund and Due Date', {
    refund: [T.refund, 'read.refund'],
    dueOn: ['string', 'due.dueOn'],
    why: [{ list: 'string' }, 'due.reasons']
  });
  g.add('approveSummary', 'billing.refund-summary', { label: 'Task Summary' });
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
  const note = template(g, 'refundNote', 'Refund Note', 'Refund approved[: {note}]', {
    note: 'approve.note'
  });
  g.add('reread', 'billing.read-refund', { label: 'Read Credit Balance Again' });
  g.add('amount', 'billing.refund-amount', { label: 'Refund Amount' });
  g.add('owed', 'std.flow.branch', { label: 'Still Owed?' });
  g.add('record', 'billing.record-refund', { label: 'Record Refund' });
  g.ret('refundedReturn', 'refunded');
  g.ret('keptReturn', 'keptCredit');
  g.wire('entry.exec', 'follow.exec');
  g.wire('entry.claimId', 'follow.claimId', 'read.claimId', 'reread.claimId', 'record.claimId');
  g.wire('entry.subject', 'approve.subject');
  g.wire('follow.then', 'read.exec');
  g.wire('read.refund', 'due.refund', 'approveSummary.refund');
  g.wire('due.dueOn', 'approve.due', 'approveSummary.dueOn');
  g.wire(details, 'approve.context');
  g.wire('approveSummary.summary', 'approve.summary');
  g.wire('read.then', 'approve.exec');
  g.wire('approve.refund', 'reread.exec');
  g.wire('reread.refund', 'amount.refund');
  g.wire('reread.then', 'owed.exec');
  g.wire('amount.owed', 'owed.condition');
  g.wire('owed.true', 'record.exec');
  g.wire('owed.false', 'refundedReturn.exec');
  g.wire('amount.amountCents', 'record.amountCents');
  g.wire('amount.coverageId', 'record.coverageId');
  g.wire(note, 'record.note');
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
      d('closing', 'string', 'Closing', 'How the claim would close: writeOff or collections.'),
      BALANCE,
      THRESHOLD,
      p('subject', 'string', true),
      p('context', 'any', true)
    ],
    outputs: [],
    exits: {
      approved: exit('Approved', 'The closing needs no approval or was approved.'),
      rejected: exit('Rejected', 'The closing was not approved; the cycle decides again.')
    }
  });
  g.add('rule', 'std.logic.greater', { label: 'Above the Approval Threshold' });
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
  recordEvent(g, 'approvedWriteOff', 'closing_approved', 'Log the Write-Off Approval', {
    note: 'Write-off approved'
  });
  recordEvent(g, 'approvedCollections', 'closing_approved', 'Log the Collections Approval', {
    note: 'Collections placement approved'
  });
  const balance = orElse(
    g,
    'balanceText',
    'Balance, Else This Balance',
    money(g, 'balance', 'Balance', 'entry.balanceCents'),
    fixed('this balance')
  );
  const threshold = money(g, 'threshold', 'Approval Threshold', 'entry.thresholdCents');
  g.ret('approvedReturn', 'approved');
  g.ret('rejectedReturn', 'rejected');
  g.wire('entry.exec', 'needed.exec');
  g.wire('entry.balanceCents', 'rule.a');
  g.wire('entry.thresholdCents', 'rule.b');
  g.wire('rule.result', 'needed.condition');
  g.wire('needed.false', 'approvedReturn.exec');
  g.wire('needed.true', 'which.exec');
  g.wire('entry.closing', 'which.value');
  g.wire('which.collections', 'collections.exec');
  g.wire('which.default', 'writeOff.exec');
  g.wire('entry.subject', 'writeOff.subject', 'collections.subject');
  g.wire('entry.context', 'writeOff.context', 'collections.context');
  g.wire(
    template(
      g,
      'writeOffSummary',
      'Write-Off Approval Summary',
      'Approve writing off {balance}[, above the {threshold} limit], or reject it to send it back',
      { balance, threshold }
    ),
    'writeOff.summary'
  );
  g.wire(
    template(
      g,
      'collectionsSummary',
      'Collections Approval Summary',
      'Approve sending {balance} to collections, or reject it to send it back',
      { balance }
    ),
    'collections.summary'
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
    'Works out the last day to act: the days allowed, counted from a given day or from today when there is none.',
    dueAfterDays()
  ),
  asRule(
    'billing.time-left',
    'Time Left',
    'Works out how long is left until a moment, or none once it has passed, for a wait that should end then.',
    timeLeft()
  ),
  asRule(
    'billing.denial-category',
    'Denial Category',
    'Suggests what a payer denial needs, from its route and reason codes, the first that holds: correct the claim, appeal it, bill another payer, move the balance to the patient or write it off, with why.',
    denialCategory()
  ),
  asRule(
    'billing.denial-summary',
    'Denial Summary',
    'Writes the summary of a Denial Decision task: who denied the claim, with which reason codes, the balance left open and what is suggested.',
    denialSummary()
  ),
  asRule(
    'billing.correction-method',
    'Correction Method',
    "Decides how a claim the payer has is corrected, the first rule that holds: a new claim (frequency 1) when the payer never adjudicated it or returned it as unprocessable, a replacement (frequency 7) or void (frequency 8) of the payer's claim, or a reopening request where the payer takes no corrected claims, as Medicare does.",
    correctionMethod()
  ),
  asRule(
    'billing.appeal-level',
    'Appeal Level and Deadline',
    "Decides the next appeal level of a denial from the payer kind and the appeals already sent, and the day it is due from that level's days in the Appeal Levels table: Medicare redetermination within 120 days of the remittance, then reconsideration within 180 days, and other payers by their appeal limit in the payer directory or the table's days, with how long to wait for the decision.",
    appealLevel()
  ),
  asRule(
    'billing.appeal-summaries',
    'Appeal Summaries',
    'Writes the summaries of the Send Appeal and Appeal Decision Overdue tasks: the appeal level, the payer, the denial codes and the due date.',
    appealSummaries()
  ),
  asRule(
    'billing.appeal-decision',
    'Appeal Decision',
    'Decides what the remittance a payer sent after an appeal means: overturned when it paid and nothing is owed, partly overturned when it paid something, else upheld.',
    appealDecision()
  ),
  asRule(
    'billing.records-due',
    'Records Due',
    'Decides when the records a payer asked for are due: the date the request names, or else the days the Records Deadlines table allows that kind of payer.',
    recordsDue()
  ),
  asRule(
    'billing.refund-due',
    'Refund Due',
    'Decides when a credit balance must be refunded, from the Refund Deadlines table: Medicare and Medicaid within 60 days of being identified (42 CFR 401.305), patients within 30 days, other payers within 60.',
    refundDue()
  ),
  asRule(
    'billing.refund-amount',
    'Refund Amount',
    'Decides how much of a credit balance to refund and to whom: the credit, but never more than the payer or patient who paid last paid in all.',
    refundAmount()
  ),
  asRule(
    'billing.refund-summary',
    'Refund Summary',
    'Writes the summary of an Approve Refund task: who overpaid, by how much, and when the refund is due.',
    refundSummary()
  ),
  asRule(
    'billing.payer-response-amounts',
    'Payer Response Amounts',
    "Works out what a payer allowed from what it sent: what it paid, plus the patient's cost share it stated (group PR with a reason in Cost Share Codes), plus Medicare sequestration (group CO with a reason in Sequestration Codes), and whether it sent any adjustments at all (a payment posted by hand may have none).",
    payerResponseAmounts()
  ),
  asRule(
    'billing.patient-responsibility',
    'Patient Responsibility',
    'Decides how much of the balance the patient may be billed, by the first balance-billing protection that holds (dual eligibility, the payer kind, the plan type, and state laws by state and date of service): all of it, only the in-network cost share the last payer stated (its patient responsibility adjustments), or none, with why. The patient is dual eligible when the claim has a payer in Medicare Claim Filings and one in Medicaid Claim Filings.',
    patientResponsibility()
  ),
  asStage(
    'billing.approve-closing',
    'Approve Closing',
    'Asks someone who may approve claims to approve writing off a balance, or sending it to collections, when it is above the Claim Policy threshold, and logs the approval.',
    approveClosing()
  ),
  asStage(
    'billing.correct-claim',
    'Correct Claim',
    'The one way a claim the payer has is corrected, used by Work Denial, Reconcile Payment and Follow Up with Payer. Correction Method decides how; then it queues a new or replacement claim (filed by the claim cycle once the data is corrected and reviewed), files a void through Submit to Payer and moves on from the payer, or asks a biller to request a reopening and waits for the payer to reprocess the claim.',
    correctClaim()
  ),
  asStage(
    'billing.appeal-claim',
    'Appeal Claim',
    'Appeals a denial: decides its level and due date (Appeal Level and Deadline), stores an appeal packet in the claim files and asks a biller to send it. It then waits for the payer to decide (a new remittance, read by Appeal Decision) and asks a biller when the decision is overdue, counted from when the appeal was sent however often the claim changes meanwhile. Used by Work Denial.',
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
    'Started from a claim: a Log records request task enters a request for records a payer sent (an additional documentation request) with its due date. It logs the request, decides when the records are due (Records Due) by the kind of payer asking, not the one being billed, and asks a biller to gather and send them by then.',
    logRecordsRequest()
  ),
  asWorkflow(
    'billing.refund-overpayment',
    'Refund Overpayment',
    'Works a credit balance: reads who overpaid, decides when the refund is due (Refund Due) and asks someone who may approve claims to approve it. It then reads the credit again and records a refund of what is still owed (Refund Amount), never more than the credit or what that payer paid. Started by the claim cycle.',
    refundOverpayment()
  )
];
