import type { FieldSpec, GraphDef, ValueType } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  assigned,
  beginClaimTask,
  claimSummary,
  claimTask,
  EDIT_PERMISSION
} from './claim-tasks.ts';
import {
  asRule,
  asWorkflow,
  condition,
  d,
  getField,
  listItem,
  makeObject,
  rule,
  shared,
  T
} from './shared.ts';

const CANDIDATE = listItem(T.candidates);

const PAYER_IDS: ValueType = { list: { id: 'payer' } };

const CANDIDATE_IN = d('candidate', CANDIDATE, 'Coverage Found', 'One coverage discovery found.');

const ON_CLAIM_IN = d(
  'onClaim',
  PAYER_IDS,
  'Payers on the Claim',
  'The directory payers already on the claim.'
);

const CANDIDATES_OUT = d(
  'candidates',
  T.candidates,
  'Coverages to Offer',
  'The coverages found whose payer is not on the claim yet, best first.'
);

const candidateIsNew = (): GraphDef => {
  const g = rule(
    [CANDIDATE_IN, ON_CLAIM_IN],
    [
      d(
        'keep',
        'boolean',
        'Not on the Claim',
        'Whether the payer of the coverage is not on the claim yet.'
      )
    ]
  );
  g.wire(
    condition(
      g,
      'notOnClaim',
      'Its Payer Is Not on the Claim',
      {
        payerId: [
          { id: 'payer' },
          getField(g, 'payerId', 'Payer', CANDIDATE, 'payerId', 'entry.candidate')
        ],
        onClaim: [PAYER_IDS, 'entry.onClaim']
      },
      [{ field: 'payerId', op: 'notOneOf', input: 'onClaim' }]
    ),
    'return.keep'
  );
  g.ret('return');
  return g.def;
};

const candidateRank = (): GraphDef => {
  const g = rule(
    [CANDIDATE_IN],
    [
      d(
        'ranked',
        { object: { candidate: CANDIDATE, rank: 'integer' } },
        'Ranked Coverage',
        'The coverage with its rank: lower ranks are offered first.'
      )
    ]
  );
  g.add('order', 'std.table.lookup', {
    label: 'Discovered Payer Order',
    config: shared.lookup(
      'billing.discovered-payer-order',
      'Discovered Payer Order',
      'The order discovered coverages are offered in, by how the 271 named the payer: the primary payer it reports (PRP) first, then the payer that answered (PR), then the secondary (SEP) and tertiary (TTP) payers it reports. Others come last.',
      {
        type: 'integer',
        rows: [
          { key: 'PRP', value: 1 },
          { key: 'PR', value: 2 },
          { key: 'SEP', value: 3 },
          { key: 'TTP', value: 4 }
        ],
        fallback: 5
      }
    )
  });
  g.ret('return');
  g.wire(getField(g, 'entity', 'Named As', CANDIDATE, 'entity', 'entry.candidate'), 'order.key');
  g.wire(
    makeObject(g, 'ranked', 'Ranked Coverage', {
      candidate: [CANDIDATE, 'entry.candidate'],
      rank: ['integer', 'order.value']
    }),
    'return.ranked'
  );
  return g.def;
};

const candidateCoverages = (): GraphDef => {
  const g = rule(
    [
      d('candidates', T.candidates, 'Coverages Found', 'The coverages discovery found.'),
      ON_CLAIM_IN
    ],
    [CANDIDATES_OUT, d('count', 'integer', 'How Many', 'How many coverages there are to offer.')]
  );
  g.add('fresh', 'std.list.filter-rule', {
    label: 'Payers Not on the Claim',
    config: { rule: 'billing.candidate-is-new', version: 1, item: 'candidate', test: 'keep' }
  });
  g.add('ranked', 'std.list.map-rule', {
    label: 'Each with Its Rank',
    config: { rule: 'billing.candidate-rank', version: 1, item: 'candidate' }
  });
  g.add('sorted', 'std.list.sort-by-field', { label: 'Sorted by Rank', values: { field: 'rank' } });
  g.add('ordered', 'std.list.pluck', {
    label: 'Coverages in Order',
    values: { field: 'candidate' }
  });
  g.add('count', 'std.list.length', { label: 'How Many' });
  g.ret('return');
  g.wire('entry.candidates', 'fresh.list');
  g.wire('entry.onClaim', 'fresh.onClaim');
  g.wire('fresh.list', 'ranked.list');
  g.wire('ranked.ranked', 'sorted.list');
  g.wire('sorted.list', 'ordered.list');
  g.wire('ordered.list', 'return.candidates', 'count.list');
  g.wire('count.length', 'return.count');
  return g.def;
};

const COVERAGE_FIELDS: FieldSpec[] = [
  { name: 'payerId', type: { id: 'payer' }, label: 'Payer', required: ['add'] },
  { name: 'memberId', type: 'string', label: 'Member ID', required: ['add'] },
  { name: 'groupId', type: 'string', label: 'Group ID' }
];

const discoverInsurance = (): GraphDef => {
  const g = claimTask();
  beginClaimTask(g);
  g.add('discover', 'billing.discover-coverage', { label: 'Discover Coverage' });
  g.add('read', 'billing.read-claim', { label: 'Read the Payers' });
  g.add('claimPayers', 'std.object.get', {
    label: 'Payers on the Claim',
    values: { path: 'payers' }
  });
  g.add('payerIds', 'std.list.pluck', {
    label: 'Their Directory Payers',
    values: { field: 'payerId' }
  });
  g.add('offer', 'billing.candidate-coverages', { label: 'Candidate Coverages' });
  g.add('anyFound', 'std.flow.branch', { label: 'Any Coverage to Offer?' });
  g.add('choices', 'std.list.reshape', {
    label: 'Payer Choices',
    config: {
      fields: [
        { name: 'value', type: 'string', from: 'payerId' },
        { name: 'label', type: 'string', from: 'payerName' }
      ]
    }
  });
  g.add('best', 'std.list.first', { label: 'Best Coverage' });
  g.add('defaults', 'std.object.pick', {
    label: 'Best Coverage Fields',
    values: { keys: COVERAGE_FIELDS.map((f) => f.name) }
  });
  claimSummary(
    g,
    'task',
    'Insurance discovery found coverage for claim {reference} that is not on it; check it with the patient or payer and add it, or say none is right'
  );
  g.add('task', 'std.human.task', {
    label: 'Confirm Discovered Coverage',
    config: {
      title: 'Confirm discovered coverage',
      queue: 'billing-review',
      permission: EDIT_PERMISSION,
      instructions:
        'Insurance discovery found coverage the claim does not list (the details show each one, best first). The best one is filled in; choose another payer and enter its member ID to add that one instead. Adding it puts the payer after the payers on the claim and checks its eligibility. Say none is right when the patient is not covered by it.',
      fields: COVERAGE_FIELDS,
      outcomes: ['add', 'none'],
      hints: {
        add: 'Adds this payer to the claim and checks its eligibility; the claim cycle bills it next.',
        none: 'Adds nothing; the claim goes on without it.'
      }
    }
  });
  g.add('add', 'billing.add-payer', { label: 'Add the Coverage' });
  g.add('eligibility', 'std.flow.start-workflow', {
    label: 'Check Eligibility of the Coverage',
    config: { workflow: 'billing.check-eligibility', version: 1 }
  });
  g.ret('done');
  g.wire('ledger.then', 'discover.exec');
  g.wire('entry.claimId', 'discover.claimId', 'read.claimId', 'add.claimId');
  g.wire('discover.answered', 'read.exec');
  g.wire('discover.unavailable', 'done.exec');
  g.wire('read.claim', 'claimPayers.object');
  g.wire('claimPayers.value', 'payerIds.list');
  g.wire('discover.candidates', 'offer.candidates');
  g.wire('payerIds.list', 'offer.onClaim');
  g.wire('read.then', 'anyFound.exec');
  g.wire(
    condition(g, 'found', 'A Coverage to Offer', { count: ['integer', 'offer.count'] }, [
      { field: 'count', op: 'gt', value: 0 }
    ]),
    'anyFound.condition'
  );
  g.wire('anyFound.true', 'task.exec');
  g.wire('anyFound.false', 'done.exec');
  g.wire('offer.candidates', 'choices.list', 'best.list');
  g.wire(
    makeObject(g, 'options', 'Task Choices', {
      payerId: [{ list: { object: { value: 'string', label: 'string' } } }, 'choices.list']
    }),
    'task.options'
  );
  g.wire('best.item', 'defaults.object');
  g.wire('defaults.object', 'task.defaults');
  g.wire(
    makeObject(g, 'context', 'Task Details', {
      claimId: [{ id: 'claim' }, 'entry.claimId'],
      candidates: [T.candidates, 'offer.candidates']
    }),
    'task.context'
  );
  assigned(g, 'task');
  g.wire('task.add', 'add.exec');
  for (const { name } of COVERAGE_FIELDS) g.wire(`task.${name}`, `add.${name}`);
  g.wire('add.then', 'eligibility.exec');
  g.wire(
    makeObject(g, 'eligibilityInputs', 'Eligibility Inputs', {
      claimId: [{ id: 'claim' }, 'entry.claimId']
    }),
    'eligibility.inputs'
  );
  g.wire('eligibility.then', 'done.exec');
  g.wire('task.none', 'done.exec');
  return g.def;
};

export const discoveryGraphs: SeedGraph[] = [
  asRule(
    'billing.candidate-is-new',
    'Candidate Is New',
    'Whether a coverage insurance discovery found has a payer that is not on the claim yet.',
    candidateIsNew()
  ),
  asRule(
    'billing.candidate-rank',
    'Candidate Rank',
    'Ranks a coverage insurance discovery found by how the 271 named its payer (Discovered Payer Order table): the primary payer it reports first, then the payer that answered.',
    candidateRank()
  ),
  asRule(
    'billing.candidate-coverages',
    'Candidate Coverages',
    'The coverages insurance discovery found that a biller can add: those whose payer is not on the claim (Candidate Is New), best first (Candidate Rank).',
    candidateCoverages()
  ),
  asWorkflow(
    'billing.discover-insurance',
    'Discover Insurance',
    'Started from a claim (Discover Insurance) or by the claim cycle when no payer covers the claim: Discover Coverage searches the payers that accept insurance searches, Candidate Coverages keeps the coverages whose payer is not on the claim, best first, and a Confirm discovered coverage task adds the one a biller confirms (Add Payer, which signals the claim cycle) and checks its eligibility. Nothing is asked of a biller when nothing new is found or no search could be sent; the discovery logged on the claim says why.',
    discoverInsurance()
  )
];
