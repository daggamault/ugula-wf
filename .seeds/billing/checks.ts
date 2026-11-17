import { CLAIM_FIX_FIELDS, type ClaimField } from '@ugula/billing';
import type { GraphDef, ValueType } from '@ugula/graph';
import { slot } from '../builder.ts';
import type { SeedGraph } from '../graphs.ts';
import {
  CHECK_FACTS_IN,
  CHECK_RULES,
  CHECK_SEVERITIES,
  checkRuleGraphs,
  REJECTED_COVERAGE_IN,
  REJECTION_IN
} from './check-rules.ts';
import { asRule, asStage, d, exit, P, rule, shared, stage, T, template } from './shared.ts';

const ISSUE_TYPE = (T.issues as { list: ValueType }).list;

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
  g.add('code', 'std.object.get-field', {
    label: 'Code',
    config: { record: ISSUE_TYPE, path: 'code' }
  });
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
    label: 'With Its Severity',
    config: { record: ISSUE_TYPE, path: 'severity' }
  });
  g.ret('return');
  g.wire('entry.issue', 'code.record', 'rated.record');
  g.wire('code.value', 'severity.key');
  g.wire('severity.value', 'rated.value');
  g.wire('rated.record', 'return.issue');
  return g.def;
};

const ids = CHECK_RULES.map((c) =>
  c.key.replace('billing.check-', '').replace(/-(\w)/g, (_, x: string) => x.toUpperCase())
);

const claimChecks = (): GraphDef => {
  const g = rule(
    [CHECK_FACTS_IN, REJECTION_IN, REJECTED_COVERAGE_IN],
    [P.issues('Every issue the checks found, with the severity the Check Severity table gives it.')]
  );
  g.add('lastSubmission', 'billing.check-last-submission', { label: 'Check Last Submission' });
  for (const [i, c] of CHECK_RULES.entries()) {
    g.add(ids[i] ?? c.key, c.key, { label: c.name });
    g.wire('entry.facts', `${ids[i]}.facts`);
  }
  g.add('found', 'std.list.join', {
    label: 'Every Check',
    config: { count: ids.length + 1, type: ISSUE_TYPE }
  });
  g.add('agency', 'billing.agency-checks', { label: 'Agency Checks' });
  g.add('rate', 'std.list.map-rule', {
    label: 'Rate Each Issue',
    config: { rule: 'billing.rate-issue', version: 1, item: 'issue' }
  });
  g.add('shown', 'std.list.where', {
    label: 'Blocking or Warning',
    config: { field: 'severity', op: 'oneOf', value: ['blocking', 'warning'] }
  });
  g.ret('return');
  g.wire('entry.rejection', 'lastSubmission.rejection');
  g.wire('entry.rejectedCoverageId', 'lastSubmission.rejectedCoverageId');
  g.wire('lastSubmission.issues', 'found.list1');
  for (const [i, id] of ids.entries()) g.wire(`${id}.issues`, `found.list${i + 2}`);
  g.wire('found.list', 'agency.issues');
  g.wire('entry.facts', 'agency.facts');
  g.wire('agency.issues', 'rate.list');
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
  g.add('field', 'std.object.get-field', {
    label: 'Field',
    config: { record: ISSUE_TYPE, path: 'field' }
  });
  g.add('coverage', 'std.object.get-field', {
    label: 'Payer',
    config: { record: ISSUE_TYPE, path: 'coverageId' }
  });
  g.add('patientMode', 'std.logic.condition', {
    label: 'Billing the Patient',
    config: {
      inputs: [{ name: 'patientOnly', type: 'boolean' }],
      rules: [{ field: 'patientOnly', op: 'is', value: true }]
    }
  });
  g.add('aboutPatient', 'std.logic.condition', {
    label: 'Not a Payer Field',
    config: {
      inputs: [{ name: 'field', type: 'string' }],
      rules: [{ field: 'field', op: 'notOneOf', value: PAYER_ONLY_FIELDS }]
    }
  });
  g.add('skippedPayer', 'std.list.contains', { label: 'About a Skipped Payer' });
  g.add('livePayer', 'std.logic.not', { label: 'Not About a Skipped Payer' });
  g.add('matters', 'std.logic.select', { label: 'Matters for This Step' });
  g.ret('return');
  g.wire('entry.issue', 'field.record', 'coverage.record');
  g.wire('entry.patientOnly', 'patientMode.patientOnly');
  g.wire('field.value', 'aboutPatient.field');
  g.wire('entry.skipped', 'skippedPayer.list');
  g.wire('coverage.value', 'skippedPayer.item');
  g.wire('skippedPayer.result', 'livePayer.value');
  g.wire('patientMode.result', 'matters.condition');
  g.wire('aboutPatient.result', 'matters.whenTrue');
  g.wire('livePayer.result', 'matters.whenFalse');
  g.wire('matters.result', 'return.matters');
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
  g.add('read', 'billing.read-claim-checks', { label: 'Read Claim for Checks' });
  g.add('checks', 'billing.claim-checks', { label: 'Claim Checks' });
  g.add('relevant', 'std.list.filter-rule', {
    label: 'Issues That Matter Now',
    config: { rule: 'billing.issue-matters-now', version: 1, item: 'issue', test: 'matters' }
  });
  g.add('form', 'billing.fix-claim-form', { label: 'Fix Claim Form' });
  g.add('blockers', 'std.list.where', {
    label: 'Blocking Issues',
    config: { field: 'severity', op: 'is', value: 'blocking' }
  });
  g.add('blocking', 'std.logic.condition', {
    label: 'Anything Blocking',
    config: {
      inputs: [{ name: 'blocking', type: 'integer' }],
      rules: [{ field: 'blocking', op: 'gt', value: 0 }]
    }
  });
  g.add('decide', 'std.flow.branch', { label: 'Blocked?' });
  g.ret('validDone', 'valid');
  g.ret('invalidDone', 'invalid');
  g.wire('entry.exec', 'read.exec');
  g.wire('entry.claimId', 'read.claimId', 'form.claimId');
  g.wire('read.facts', 'checks.facts');
  g.wire('entry.rejection', 'checks.rejection');
  g.wire('entry.rejectedCoverageId', 'checks.rejectedCoverageId');
  g.wire('checks.issues', 'relevant.list');
  g.wire('read.skipped', 'relevant.skipped');
  g.wire('entry.patientOnly', 'relevant.patientOnly');
  g.wire('relevant.list', 'form.issues', 'blockers.list');
  g.wire('blockers.count', 'blocking.blocking');
  g.wire('entry.all', 'form.all');
  g.wire('read.then', 'form.exec');
  g.wire('form.then', 'decide.exec');
  g.wire('blocking.result', 'decide.condition');
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
  g.add('ask', 'std.var.set', { label: 'Ask Every Field First?', config: { name: 'askAll' } });
  g.add('askAll', 'std.var.get', { label: 'Asking Every Field', config: { name: 'askAll' } });
  g.add('check', 'billing.check-claim', { label: 'Check Claim' });
  g.add('asked', 'std.flow.branch', { label: 'Asked to Fix Anyway?' });
  g.add('facilityIssues', 'std.list.where', {
    label: 'Facility Responsible Issues',
    config: { field: 'code', op: 'is', value: 'facility-responsible' }
  });
  g.add('facilityBlockers', 'std.list.where', {
    label: 'That Block',
    config: { field: 'severity', op: 'is', value: 'blocking' }
  });
  g.add('facilityBlocks', 'std.logic.condition', {
    label: 'A Facility Is Responsible',
    config: {
      inputs: [{ name: 'blocking', type: 'integer' }],
      rules: [{ field: 'blocking', op: 'gt', value: 0 }]
    }
  });
  g.add('toFacility', 'std.flow.branch', { label: 'Bill a Facility?' });
  g.add('responsibility', 'billing.decide-responsibility', { label: 'Decide Responsibility' });
  g.add('billFacility', 'billing.bill-facility', { label: 'Bill Facility' });
  g.add('fixContext', 'std.object.make', {
    label: 'Fix Context',
    config: {
      fields: [
        { name: 'issues', type: T.issues },
        { name: 'claim', type: 'any' }
      ]
    }
  });
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
  g.wire('facilityBlockers.count', 'facilityBlocks.blocking');
  g.wire('facilityBlocks.result', 'toFacility.condition');
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
  g.wire('check.issues', 'fixContext.issues');
  g.wire('entry.context', 'fixContext.claim');
  g.wire('fixContext.object', 'fix.context');
  g.wire('check.visible', 'fix.visible');
  g.wire('check.defaults', 'fix.defaults', 'patch.shown');
  g.wire('check.options', 'fix.options');
  g.wire('entry.subject', 'fix.subject');
  template(g, 'payerName', 'Payer Name', '{context.payer}', { context: 'entry.context' });
  g.add('payerOrClaim', 'std.logic.choose', {
    label: 'Payer, Else This Claim',
    config: { mode: 'first', type: 'string', count: 2 },
    values: { option2: 'this claim' }
  });
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
  g.wire('payerName.text', 'payerOrClaim.option1');
  g.wire('entry.patientOnly', 'billed.key');
  g.wire('payerOrClaim.value', 'billed.otherwise');
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
  g.wire('fixContext.object', 'reprice.context');
  g.wire('reprice.repriced', 'check.exec');
  g.wire('reprice.voided', 'voidedDone.exec');
  g.wire('fix.void', 'voidedDone.exec');
  g.wire('fix.backToReview', 'reviewDone.exec');
  return g.def;
};

export const checkGraphs: SeedGraph[] = [
  slot(
    'billing.agency-checks',
    'Agency Checks',
    'An agency rule after the base claim checks: add checks of its own (a payer that needs a facesheet, say) or drop issues, before severities apply. Passes the issues through unchanged until an agency overrides it.',
    {
      execIn: [],
      execOut: [],
      inputs: [
        d('issues', T.issues, 'Issues', 'The issues the base checks found.'),
        d('facts', T.checkFacts, 'Check Facts', 'The claim as the checks read it.', true)
      ],
      outputs: [d('issues', T.issues, 'Issues', 'The issues to rate and show.')]
    }
  ),
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
    'billing.claim-checks',
    'Claim Checks',
    'Runs every claim check on the check facts, then the Agency Checks rule, and rates each issue with the Check Severity table (blocking, warning or off).',
    claimChecks()
  ),
  asStage(
    'billing.check-claim',
    'Check Claim',
    'Reads the saved claim, runs the Claim Checks, keeps the issues that matter now (none about skipped payers; only patient ones before billing the patient) and lays out the fix form. Continues through invalid when an issue blocks the claim.',
    checkClaim()
  ),
  asStage(
    'billing.fix-claim',
    'Fix Claim',
    'Checks a saved claim and, while anything blocks it (or always, with all), asks a biller to fix the fields the issues name, applies the fixes, reprices when the Reprice Triggers rule says so and checks again; a claim the Facility Responsibility rule bills to a facility goes to Bill Facility instead, then is checked again. With patientOnly, only issues that matter for billing the patient count. Continues through fixed, voided or backToReview.',
    fixClaim()
  )
];
