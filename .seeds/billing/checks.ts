import { CLAIM_FIX_FIELDS, type ClaimField } from '@ugula/billing';
import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import { CLAIM_RECORD_IN } from './check-facts.ts';
import {
  CHECK_RULES,
  CHECK_SEVERITIES,
  camel,
  checkRuleGraphs,
  ISSUE_TYPE,
  REJECTED_COVERAGE_IN,
  REJECTION_IN
} from './check-rules.ts';
import {
  asRule,
  asStage,
  condition,
  d,
  exit,
  fixed,
  getField,
  makeObject,
  orElse,
  P,
  rule,
  select,
  shared,
  stage,
  T,
  template
} from './shared.ts';

const ISSUE_IN = d('issue', ISSUE_TYPE, 'Issue', 'One issue a check found.');

const rateIssue = (): GraphDef => {
  const g = rule(
    [ISSUE_IN],
    [
      d(
        'issue',
        ISSUE_TYPE,
        'Issue',
        'The issue with the severity the Check Severity table gives its code.'
      )
    ]
  );
  const code = getField(g, 'code', 'Issue Code', ISSUE_TYPE, 'code', 'entry.issue');
  g.add('severity', 'std.table.lookup', {
    label: 'Check Severity',
    config: shared.lookup(
      'billing.check-severity',
      'Check Severity',
      'How much each claim check matters: blocking keeps the claim from going out, warning shows it to the biller, off ignores it. A code not listed blocks.',
      {
        type: 'string',
        rows: Object.entries(CHECK_SEVERITIES).map(([key, value]) => ({ key, value })),
        fallback: 'blocking'
      }
    )
  });
  g.add('rated', 'std.object.set-field', {
    label: 'Issue with Its Severity',
    config: { record: ISSUE_TYPE, path: 'severity' }
  });
  g.ret('return');
  g.wire('entry.issue', 'rated.record');
  g.wire(code, 'severity.key');
  g.wire('severity.value', 'rated.value');
  g.wire('rated.record', 'return.issue');
  return g.def;
};

const RULES = CHECK_RULES.map((c) => ({ ...c, id: camel(c.key.replace('billing.check-', '')) }));

const ALL_ISSUES_OUT = P.issues(
  'Every issue the checks found, with the severity the Check Severity table gives it.'
);

const claimIssues = (): GraphDef => {
  const g = rule([CLAIM_RECORD_IN, REJECTION_IN, REJECTED_COVERAGE_IN], [ALL_ISSUES_OUT]);
  g.add('facts', 'billing.claim-check-facts', { label: 'Claim Check Facts' });
  g.add('lastSubmission', 'billing.check-last-submission', { label: 'Check Last Submission' });
  for (const c of RULES) {
    g.add(c.id, c.key, { label: c.name });
    g.wire('facts.facts', `${c.id}.facts`);
  }
  g.add('found', 'std.list.join', {
    label: 'Every Issue Found',
    config: { count: RULES.length + 1, type: ISSUE_TYPE }
  });
  g.add('rate', 'std.list.map-rule', {
    label: 'Rate Each Issue',
    config: { rule: 'billing.rate-issue', version: 1, item: 'issue' }
  });
  g.add('shown', 'std.list.where', {
    label: 'Blocking or Warning Issues',
    config: { field: 'severity', op: 'oneOf', value: ['blocking', 'warning'] }
  });
  g.ret('return');
  g.wire('entry.record', 'facts.record');
  g.wire('entry.rejection', 'lastSubmission.rejection');
  g.wire('entry.rejectedCoverageId', 'lastSubmission.rejectedCoverageId');
  g.wire('lastSubmission.issues', 'found.list1');
  for (const [i, c] of RULES.entries()) g.wire(`${c.id}.issues`, `found.list${i + 2}`);
  g.wire('found.list', 'rate.list');
  g.wire('rate.issue', 'shown.list');
  g.wire('shown.list', 'return.issues');
  return g.def;
};

const PAYER_ONLY_FIELDS = [
  'payers',
  'payer',
  'memberId',
  'insured',
  'signature',
  'pcs',
  'abn',
  'msp',
  'priorAuthorization',
  'facility',
  'filing',
  'submission'
] satisfies ClaimField[];

const issueMattersNow = (): GraphDef => {
  const g = rule(
    [
      ISSUE_IN,
      d(
        'patientOnly',
        'boolean',
        'Patient Billing',
        'Billing the patient, so only issues about the patient and the trip count.',
        true
      ),
      d(
        'skipped',
        { list: { id: 'coverage' } },
        'Skipped Payers',
        'The payers already skipped, whose issues no longer matter.',
        true
      )
    ],
    [d('matters', 'boolean', 'Matters Now', 'Whether the issue matters for this step.')]
  );
  const field = getField(g, 'field', 'Field to Fix', ISSUE_TYPE, 'field', 'entry.issue');
  const coverage = getField(g, 'coverage', 'Issue Payer', ISSUE_TYPE, 'coverageId', 'entry.issue');
  const patientMode = condition(
    g,
    'patientMode',
    'Billing the Patient',
    { patientOnly: ['boolean', 'entry.patientOnly'] },
    [{ field: 'patientOnly', op: 'is', value: true }]
  );
  const aboutPatient = condition(
    g,
    'aboutPatient',
    'About the Patient or the Trip',
    { field: ['string', field] },
    [{ field: 'field', op: 'notOneOf', value: PAYER_ONLY_FIELDS }]
  );
  g.add('skippedPayer', 'std.list.contains', { label: 'About a Skipped Payer' });
  g.add('livePayer', 'std.logic.not', { label: 'Not About a Skipped Payer' });
  g.ret('return');
  g.wire('entry.skipped', 'skippedPayer.list');
  g.wire(coverage, 'skippedPayer.item');
  g.wire('skippedPayer.result', 'livePayer.value');
  g.wire(
    select(g, 'matters', 'Matters for This Step', patientMode, aboutPatient, 'livePayer.result'),
    'return.matters'
  );
  return g.def;
};

const ISSUES_OUT = P.issues('The issues that matter for this step, with their severity.');

const FORM_OUT = [
  d('visible', { list: 'string' }, 'Fields to Fix', 'The Fix Claim Data fields the issues name.'),
  d('defaults', { object: {} }, 'Current Values', 'The current value of each field.'),
  d('options', { object: {} }, 'Choices', 'The payer and directory choices of the form.')
];

const checkClaim = (): GraphDef => {
  const g = stage(
    [
      P.claimId(),
      d(
        'all',
        'boolean',
        'Every Field',
        'Lay out every field of the fix form, not only those the issues name.',
        true
      ),
      d(
        'patientOnly',
        'boolean',
        'Patient Billing',
        'Only issues that matter for billing the patient (payer issues are left out).',
        true
      ),
      REJECTION_IN,
      REJECTED_COVERAGE_IN
    ],
    [
      ISSUES_OUT,
      d('claim', { object: {} }, 'Claim', 'The claim as checked, for task details.'),
      ...FORM_OUT
    ],
    {
      valid: exit('Valid', 'Nothing blocks the claim.'),
      invalid: exit('Invalid', 'A blocking issue keeps the claim from going out.')
    }
  );
  g.add('read', 'billing.read-claim', { label: 'Read Claim' });
  g.add('issues', 'billing.claim-issues', { label: 'Claim Issues' });
  g.add('relevant', 'std.list.filter-rule', {
    label: 'Issues That Matter Now',
    config: { rule: 'billing.issue-matters-now', version: 1, item: 'issue', test: 'matters' }
  });
  g.add('form', 'billing.fix-claim-form', { label: 'Fix Claim Form' });
  g.add('blockers', 'std.list.where', {
    label: 'Blocking Issues',
    config: { field: 'severity', op: 'is', value: 'blocking' }
  });
  g.add('decide', 'std.flow.branch', { label: 'Blocked?' });
  g.ret('validDone', 'valid');
  g.ret('invalidDone', 'invalid');
  g.wire('entry.exec', 'read.exec');
  g.wire('entry.claimId', 'read.claimId', 'form.claimId');
  g.wire('read.record', 'issues.record');
  g.wire('entry.rejection', 'issues.rejection');
  g.wire('entry.rejectedCoverageId', 'issues.rejectedCoverageId');
  g.wire('issues.issues', 'relevant.list');
  g.wire('read.skipped', 'relevant.skipped');
  g.wire('entry.patientOnly', 'relevant.patientOnly');
  g.wire('relevant.list', 'form.issues', 'blockers.list');
  g.wire(
    condition(
      g,
      'blocking',
      'An Issue Blocks the Claim',
      { blocking: ['integer', 'blockers.count'] },
      [{ field: 'blocking', op: 'gt', value: 0 }]
    ),
    'decide.condition'
  );
  g.wire('entry.all', 'form.all');
  g.wire('read.then', 'form.exec');
  g.wire('form.then', 'decide.exec');
  g.wire('decide.true', 'invalidDone.exec');
  g.wire('decide.false', 'validDone.exec');
  for (const done of ['validDone', 'invalidDone']) {
    g.wire('relevant.list', `${done}.issues`);
    g.wire('read.claim', `${done}.claim`);
    for (const pin of ['visible', 'defaults', 'options']) g.wire(`form.${pin}`, `${done}.${pin}`);
  }
  return g.def;
};

const fixClaim = (): GraphDef => {
  const g = stage(
    [
      P.claimId(),
      d(
        'all',
        'boolean',
        'Ask Every Field',
        'Ask about every field once, even when nothing blocks the claim.',
        true
      ),
      d(
        'patientOnly',
        'boolean',
        'Patient Billing',
        'Only issues that matter for billing the patient (payer issues are left out).',
        true
      ),
      P.subject(),
      P.context()
    ],
    [],
    {
      fixed: exit('Fixed', 'Nothing blocks the claim any more.'),
      voided: exit('Voided', 'A biller voided the claim.'),
      backToReview: exit('Back to Review', 'A biller sent the claim back to PCR review.')
    },
    [{ name: 'askAll', type: 'boolean', default: false }]
  );
  g.add('ask', 'std.var.set', { label: 'Remember Ask Every Field', config: { name: 'askAll' } });
  g.add('askAll', 'std.var.get', { label: 'Ask Every Field', config: { name: 'askAll' } });
  g.add('check', 'billing.check-claim', { label: 'Check Claim' });
  g.add('asked', 'std.flow.branch', { label: 'Asked to Fix Anyway?' });
  g.add('facilityIssues', 'std.list.where', {
    label: 'Facility Responsible Issues',
    config: { field: 'code', op: 'is', value: 'facility-responsible' }
  });
  g.add('facilityBlockers', 'std.list.where', {
    label: 'Blocking Facility Issues',
    config: { field: 'severity', op: 'is', value: 'blocking' }
  });
  g.add('toFacility', 'std.flow.branch', { label: 'Bill a Facility?' });
  g.add('responsibility', 'billing.decide-responsibility', { label: 'Decide Responsibility' });
  g.add('billFacility', 'billing.bill-facility', { label: 'Bill Facility' });
  g.add('fix', 'std.human.task', {
    label: 'Fix Claim Data',
    config: {
      title: 'Fix claim data',
      queue: 'billing-review',
      instructions:
        'The claim is missing something or has something wrong, listed with the field it is fixed in. Correct the fields below and save, and the claim is checked again; empty fields are left as they are. Charges are mapped and priced again when the classification, service, miles or payers change. Void the claim if it should never be billed.',
      fields: CLAIM_FIX_FIELDS,
      outcomes: ['save', 'void', 'backToReview'],
      hints: {
        save: 'Applies the fixes, reprices if needed and checks the claim; this task comes back while anything blocks it.',
        void: 'Voids the claim so it is never billed.',
        backToReview: 'Saves nothing and hands the claim back to the step that asked for this fix.'
      },
      prefill: 'current'
    }
  });
  g.add('stopAsking', 'std.var.set', {
    label: 'Ask Only About Issues Now',
    config: { name: 'askAll' },
    values: { value: false }
  });
  g.input('claimIdToPatch', 'claimId');
  g.input('subjectToReprice', 'subject');
  g.add('patch', 'billing.patch-claim', { label: 'Apply the Fixes' });
  g.add('triggers', 'billing.reprice-triggers', { label: 'Reprice Triggers' });
  g.add('repriceNeeded', 'std.flow.branch', { label: 'Reprice?' });
  g.add('reprice', 'billing.reprice-claim', { label: 'Reprice Changed Charges' });
  g.ret('fixedDone', 'fixed');
  g.ret('voidedDone', 'voided');
  g.ret('reviewDone', 'backToReview');
  g.wire('entry.exec', 'ask.exec');
  g.wire('entry.all', 'ask.value');
  g.wire('ask.then', 'check.exec');
  g.wire('entry.claimId', 'check.claimId');
  g.wire('entry.patientOnly', 'check.patientOnly');
  g.wire('claimIdToPatch.claimId', 'patch.claimId', 'reprice.claimId');
  g.wire('askAll.value', 'check.all', 'asked.condition');
  g.wire('check.invalid', 'toFacility.exec');
  g.wire('check.issues', 'facilityIssues.list');
  g.wire('facilityIssues.list', 'facilityBlockers.list');
  g.wire(
    condition(
      g,
      'facilityBlocks',
      'A Facility Is Responsible',
      { blocking: ['integer', 'facilityBlockers.count'] },
      [{ field: 'blocking', op: 'gt', value: 0 }]
    ),
    'toFacility.condition'
  );
  g.wire('toFacility.false', 'fix.exec');
  g.wire('toFacility.true', 'responsibility.exec');
  g.wire('claimIdToPatch.claimId', 'responsibility.claimId', 'billFacility.claimId');
  g.wire('responsibility.payers', 'fix.exec');
  g.wire('responsibility.facility', 'billFacility.exec');
  g.wire('responsibility.facilityId', 'billFacility.facilityId');
  g.wire('responsibility.reason', 'billFacility.reason');
  g.wire('entry.subject', 'billFacility.subject');
  g.wire('entry.context', 'billFacility.context');
  g.wire('billFacility.billed', 'check.exec');
  g.wire('billFacility.payers', 'check.exec');
  g.wire('billFacility.voided', 'voidedDone.exec');
  g.wire('check.valid', 'asked.exec');
  g.wire('asked.true', 'fix.exec');
  g.wire('asked.false', 'fixedDone.exec');
  const fixContext = makeObject(g, 'fixContext', 'Task Details with the Issues', {
    issues: [T.issues, 'check.issues'],
    claim: ['any', 'entry.context']
  });
  g.wire(fixContext, 'fix.context', 'reprice.context');
  g.wire('check.visible', 'fix.visible');
  g.wire('check.defaults', 'fix.defaults', 'patch.shown');
  g.wire('check.options', 'fix.options');
  g.wire('entry.subject', 'fix.subject');
  const payerOrClaim = orElse(
    g,
    'payerOrClaim',
    'Payer, Else This Claim',
    template(g, 'payerName', 'Payer Name', '{context.payer}', { context: 'entry.context' }),
    fixed('this claim')
  );
  g.add('billed', 'std.logic.choose', {
    label: 'Who Is Billed',
    config: { mode: 'byCase', type: 'string', cases: [{ when: 'true' }] },
    values: { case1: 'the patient' }
  });
  template(
    g,
    'nothingBlocks',
    'Nothing Blocks',
    'Nothing blocks billing {billed}; correct any field below and save to check the claim again'
  );
  g.add('fixSummary', 'billing.blocking-summary', { label: 'Task Summary' });
  g.wire('entry.patientOnly', 'billed.key');
  g.wire(payerOrClaim, 'billed.otherwise');
  g.wire('billed.value', 'nothingBlocks.billed', 'fixSummary.billed');
  g.wire('check.issues', 'fixSummary.issues');
  g.wire('nothingBlocks.text', 'fixSummary.otherwise');
  g.wire('fixSummary.summary', 'fix.summary');
  g.wire('subjectToReprice.subject', 'reprice.subject');
  g.wire('fix.save', 'stopAsking.exec');
  g.wire('stopAsking.then', 'patch.exec');
  for (const { name } of CLAIM_FIX_FIELDS) g.wire(`fix.${name}`, `patch.${name}`);
  g.wire('patch.changes', 'triggers.changes');
  g.wire('patch.then', 'repriceNeeded.exec');
  g.wire('triggers.reprice', 'repriceNeeded.condition');
  g.wire('repriceNeeded.false', 'check.exec');
  g.wire('repriceNeeded.true', 'reprice.exec');
  g.wire('patch.classification', 'reprice.classification');
  g.wire('patch.service', 'reprice.service');
  g.wire('patch.payerId', 'reprice.payerId');
  g.wire('reprice.repriced', 'check.exec');
  g.wire('reprice.voided', 'voidedDone.exec');
  g.wire('fix.void', 'voidedDone.exec');
  g.wire('fix.backToReview', 'reviewDone.exec');
  return g.def;
};

export const checkGraphs: SeedGraph[] = [
  ...checkRuleGraphs,
  asRule(
    'billing.rate-issue',
    'Rate Issue',
    'Gives an issue the severity the Check Severity table names for its code: blocking, warning or off.',
    rateIssue()
  ),
  asRule(
    'billing.issue-matters-now',
    'Issue Matters Now',
    'Whether an issue matters for this step: when billing the patient, only issues about the patient and the trip; otherwise every issue except those about payers already skipped.',
    issueMattersNow()
  ),
  asRule(
    'billing.claim-issues',
    'Claim Issues',
    'Works out the Claim Check Facts from the saved claim, runs every check rule on them and rates each issue with the Check Severity table (blocking, warning or off), keeping the blocking and warning ones, so the claim page and Check Claim find the same issues. An agency adds or drops a check by overriding it.',
    claimIssues()
  ),
  asStage(
    'billing.check-claim',
    'Check Claim',
    'Reads the saved claim, finds its Claim Issues, keeps the issues that matter now (none about skipped payers; only those about the patient and the trip when billing the patient) and lays out the fix form. Continues through Invalid when an issue blocks the claim, else through Valid.',
    checkClaim()
  ),
  asStage(
    'billing.fix-claim',
    'Fix Claim',
    'Checks a saved claim and, while anything blocks it (or once anyway, with Ask Every Field), asks a biller to fix the fields the issues name, applies the fixes, reprices when the Reprice Triggers rule says so and checks again; a claim the Facility Responsibility rule bills to a facility goes to Bill Facility instead, then is checked again. With Patient Billing, only issues that matter for billing the patient count. Continues through Fixed, Voided or Back to Review.',
    fixClaim()
  )
];
