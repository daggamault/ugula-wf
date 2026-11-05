import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import { graph, p } from './glossary.ts';
import {
  asRule,
  asWorkflow,
  atMost,
  below,
  d,
  expr,
  field,
  is,
  oneOf,
  P,
  rule,
  shared,
  T,
  table
} from './shared.ts';

const TASK_KINDS = ['appeal', 'records', 'refund', 'task'];

const DEADLINE = T.deadlines.list;

const act = (
  label: string,
  when: Record<string, ReturnType<typeof is>>,
  action: string,
  priority: number,
  message = ''
) => ({ label, when, set: { action, priority, message } });

const deadlineAction = (): GraphDef => {
  const g = rule(
    [d('deadline', DEADLINE, 'Deadline', 'One claim deadline coming up, with the days left.')],
    [
      d(
        'action',
        'string',
        'Action',
        'none, raise (the open task) or remind (a new reminder task).'
      ),
      d('priority', 'integer', 'Priority', 'The priority to raise to or remind with.'),
      d('message', 'string', 'Message', 'What the reminder tells a biller.'),
      P.reasons('this is done about the deadline')
    ]
  );
  g.add('deadline', 'billing.deadline.break');
  g.add('decide', 'std.table.decide', {
    label: 'Deadline Actions',
    config: shared.decision(
      'billing.deadline-actions',
      'Deadline Actions',
      'What Watch Deadlines does about each claim deadline, top to bottom: raise the open appeal, records request or refund task as its due date nears, or open a reminder for timely filing and expiring physician certifications. {dueOn} in a message is the due date.',
      table(
        [
          field('kind', 'string', 'timelyFiling, appeal, records, refund, task or pcs'),
          field('daysLeft', 'integer', 'Days left (negative once passed)'),
          field('priority', 'integer', 'Priority of the open task'),
          field('reminded', 'boolean', 'A reminder is already open')
        ],
        [
          field('action', 'string', 'Action'),
          field('priority', 'integer', 'Priority'),
          field('message', 'string', 'Message')
        ],
        [
          act(
            'The filing limit has passed',
            { kind: is('timelyFiling'), daysLeft: atMost(0), reminded: is(false) },
            'remind',
            3,
            'The filing limit for this claim passed on {dueOn}. File it now with proof of timely filing, or write it off.'
          ),
          act(
            'The filing limit is within 30 days',
            { kind: is('timelyFiling'), daysLeft: atMost(30), reminded: is(false) },
            'remind',
            2,
            'The filing limit for this claim is {dueOn}. Get it reviewed and filed before then.'
          ),
          act(
            'A task is due within 3 days',
            { kind: oneOf(...TASK_KINDS), daysLeft: atMost(3), priority: below(3) },
            'raise',
            3
          ),
          act(
            'A task is due within 14 days',
            { kind: oneOf(...TASK_KINDS), daysLeft: atMost(14), priority: below(2) },
            'raise',
            2
          ),
          act(
            'A physician certification expires within 14 days',
            { kind: is('pcs'), daysLeft: atMost(14), reminded: is(false) },
            'remind',
            1,
            "The physician certification for this patient's scheduled trips expires on {dueOn}. Get a new one before the next trip."
          )
        ],
        { action: 'none', priority: 0, message: '' }
      )
    )
  });
  g.add(
    'message',
    'std.expr',
    expr('Message With Date', 'replace(message ?? "", "{dueOn}", dueOn)')
  );
  g.ret('return');
  g.wire('entry.deadline', 'deadline.deadline');
  for (const f of ['kind', 'daysLeft', 'priority', 'reminded'])
    g.wire(`deadline.${f}`, `decide.${f}`);
  g.wire('deadline.dueOn', 'message.dueOn');
  g.wire('decide.message', 'message.message');
  g.wire('decide.action', 'return.action');
  g.wire('decide.priority', 'return.priority');
  g.wire('message.result', 'return.message');
  g.add('reasons', 'std.expr', expr('Why', 'rule != null ? [rule] : ["Nothing is due soon"]'));
  g.wire('decide.rule', 'reasons.rule');
  g.wire('reasons.result', 'return.reasons');
  return g.def;
};

const watchDeadlines = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [],
    outputs: [d('checked', 'integer', 'Deadlines Checked', 'How many deadlines were looked at.')]
  });
  g.add('find', 'billing.find-deadlines', { label: 'Find Deadlines' });
  g.add('each', 'std.flow.for-each', { label: 'Each Deadline' });
  g.add('act', 'billing.deadline-action', { label: 'Deadline Action' });
  g.add('route', 'std.flow.switch', { label: 'By Action', config: { cases: ['raise', 'remind'] } });
  g.add('taskId', 'std.object.get', { label: 'Open Task', values: { path: 'taskId' } });
  g.add('raise', 'billing.raise-task', { label: 'Raise Task Priority' });
  g.add('reminder', 'std.expr', {
    label: 'Reminder Inputs',
    config: {
      expression:
        '{ claimId: deadline.claimId, kind: deadline.kind, dueOn: deadline.dueOn, reference: deadline.reference, message: message, priority: priority }'
    }
  });
  g.add('remind', 'std.flow.start-workflow', {
    label: 'Open a Reminder',
    config: { workflow: 'billing.deadline-reminder', version: 1 }
  });
  g.add('count', 'std.list.length', { label: 'Deadlines' });
  g.ret('return');
  g.wire('entry.exec', 'find.exec');
  g.wire('find.then', 'each.exec');
  g.wire('find.deadlines', 'each.list', 'count.list');
  g.wire('each.body', 'route.exec');
  g.wire('each.item', 'act.deadline', 'taskId.object', 'reminder.deadline');
  g.wire('act.action', 'route.value');
  g.wire('route.raise', 'raise.exec');
  g.wire('taskId.value', 'raise.taskId');
  g.wire('act.priority', 'raise.priority', 'reminder.priority');
  g.wire('act.message', 'reminder.message');
  g.wire('route.remind', 'remind.exec');
  g.wire('reminder.result', 'remind.inputs');
  g.wire('each.completed', 'return.exec');
  g.wire('count.length', 'return.checked');
  return g.def;
};

const deadlineReminder = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [
      p('claimId', 'string'),
      d('kind', 'string', 'Deadline', 'timelyFiling or pcs.'),
      d('dueOn', 'string', 'Due On', 'The due date (YYYY-MM-DD).'),
      d('reference', 'string', 'Claim', 'The claim number and patient the reminder names.'),
      d('message', 'string', 'Message', 'What the reminder tells a biller.'),
      d('priority', 'integer', 'Priority', 'How urgent the reminder is.', true)
    ],
    outputs: []
  });
  g.add('follow', 'billing.follow-claim', { label: 'Show on the Claim' });
  g.add(
    'details',
    'std.expr',
    expr('Deadline Details', '{ deadline: kind, dueOn: dueOn, message: message }')
  );
  g.add('remind', 'std.human.task', {
    label: 'Deadline Coming Up',
    config: {
      title: 'Deadline coming up',
      queue: 'billing-followup',
      instructions:
        'A deadline on this claim is near or has passed; the details say which and when. Do what it asks on the claim, then mark it done.',
      outcomes: ['done']
    }
  });
  g.ret('done');
  g.wire('entry.exec', 'follow.exec');
  g.wire('entry.claimId', 'follow.claimId');
  g.wire('entry.kind', 'details.kind');
  g.wire('entry.dueOn', 'details.dueOn', 'remind.due');
  g.wire('entry.message', 'details.message');
  g.wire('entry.reference', 'remind.subject');
  g.wire('entry.priority', 'remind.priority');
  g.wire('details.result', 'remind.context');
  g.wire('follow.then', 'remind.exec');
  g.wire('remind.done', 'done.exec');
  return g.def;
};

const invoiceFacilities = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [],
    outputs: [
      d('invoices', 'integer', 'Invoices', 'How many facility invoices were issued.'),
      d('claims', 'integer', 'Claims', 'How many trips they bill.')
    ]
  });
  g.add(
    'period',
    'std.expr',
    expr('Last Month', 'substr(addDays(substr(date(now()), 0, 8) + "01", -1), 0, 8) + "01"')
  );
  g.add('issue', 'billing.issue-facility-invoices', { label: 'Issue Facility Invoices' });
  g.ret('return');
  g.wire('entry.exec', 'issue.exec');
  g.wire('period.result', 'issue.period');
  g.wire('issue.then', 'return.exec');
  g.wire('issue.invoices', 'return.invoices');
  g.wire('issue.claims', 'return.claims');
  return g.def;
};

export const scheduleGraphs: SeedGraph[] = [
  asRule(
    'billing.deadline-action',
    'Deadline Action',
    'Decides what to do about one claim deadline (Deadline Actions table): raise its open task as it comes due, open a reminder, or nothing.',
    deadlineAction()
  ),
  asWorkflow(
    'billing.deadline-reminder',
    'Deadline Reminder',
    'A task on a claim, due when its deadline is, saying what is about to lapse. Started by Watch Deadlines.',
    deadlineReminder()
  ),
  asWorkflow(
    'billing.watch-deadlines',
    'Watch Deadlines',
    "Checks the agency's claim deadlines every day: timely filing for payers not billed yet, appeal, records request and refund due dates, and expiring physician certifications, and raises the open task or opens a reminder before they lapse (Deadline Action). Started each morning for every agency.",
    watchDeadlines()
  ),
  asWorkflow(
    'billing.invoice-facilities',
    'Invoice Facilities',
    "Issues last month's facility invoices: one PDF per facility for the trips it is responsible for with a balance left, logged in each claim's files. Started on the first of every month for every agency.",
    invoiceFacilities()
  )
];
