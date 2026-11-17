import type { GraphDef, ValueType } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import { checkLimit } from './check-rules.ts';
import { graph, p } from './glossary.ts';
import {
  asRule,
  asWorkflow,
  type Builder,
  condition,
  d,
  firstOf,
  fixed,
  listItem,
  makeList,
  makeObject,
  orElse,
  type Port,
  rule,
  select,
  shared,
  T,
  template
} from './shared.ts';

const TASK_KINDS = ['appeal', 'records', 'refund', 'task'];

const DEADLINE = listItem(T.deadlines);

const KIND_PIN = d(
  'kind',
  'string',
  'Deadline Kind',
  'Which deadline it is: timelyFiling (the filing limit) or pcs (a physician certification).'
);

const MESSAGE_PIN = d('message', 'string', 'Message', 'What the reminder tells a biller.');

const DEADLINE_LIMITS = shared.lookup(
  'billing.deadline-limits',
  'Deadline Limits',
  'The numbers Watch Deadlines works with. Look-Ahead Days: how many days ahead of a deadline it starts looking at it. Filing Reminder Days: how close the filing limit is when a reminder opens. Task Due Soon Days and Task Due Now Days: how close the due date of an open appeal, records request or refund task is when it is raised to high and then urgent priority. Certification Reminder Days: how close a physician certification is to expiring when a reminder opens.',
  {
    type: 'integer',
    rows: [
      { key: 'Look-Ahead Days', value: 90 },
      { key: 'Filing Reminder Days', value: 30 },
      { key: 'Task Due Soon Days', value: 14 },
      { key: 'Task Due Now Days', value: 3 },
      { key: 'Certification Reminder Days', value: 14 }
    ]
  }
);

const deadlineLimit = (g: Builder, id: string, key: string) => {
  g.add(id, 'std.table.lookup', { label: key, config: DEADLINE_LIMITS, values: { key } });
  return `${id}.value` as const;
};

type Act = {
  id: string;
  label: string;
  decision: string;
  kinds: string[];
  within?: [string, string];
  untilPriority?: number;
  action: 'raise' | 'remind';
  priority: number;
  reason: string;
  message?: string;
};

const ACTS: Act[] = [
  {
    id: 'filingPassed',
    decision: 'Remind: Filing Limit Passed',
    label: 'The Filing Limit Has Passed',
    kinds: ['timelyFiling'],
    action: 'remind',
    priority: 3,
    reason: 'The filing limit has passed',
    message:
      'The filing limit for this claim passed on {dueOn}. File it now with proof of timely filing, or write it off.'
  },
  {
    id: 'filingNear',
    decision: 'Remind: Filing Limit Near',
    label: 'The Filing Limit Is Near',
    kinds: ['timelyFiling'],
    within: ['filingDays', 'Filing Reminder Days'],
    action: 'remind',
    priority: 2,
    reason: 'The filing limit is within {days}',
    message: 'The filing limit for this claim is {dueOn}. Get it reviewed and filed before then.'
  },
  {
    id: 'taskDueNow',
    decision: 'Raise: Task Due Now',
    label: 'A Task Is Due Now',
    kinds: TASK_KINDS,
    within: ['nowDays', 'Task Due Now Days'],
    untilPriority: 3,
    action: 'raise',
    priority: 3,
    reason: 'A task is due within {days}'
  },
  {
    id: 'taskDueSoon',
    decision: 'Raise: Task Due Soon',
    label: 'A Task Is Due Soon',
    kinds: TASK_KINDS,
    within: ['soonDays', 'Task Due Soon Days'],
    untilPriority: 2,
    action: 'raise',
    priority: 2,
    reason: 'A task is due within {days}'
  },
  {
    id: 'pcsExpiring',
    decision: 'Remind: Certification Expiring',
    label: 'A Physician Certification Is Expiring',
    kinds: ['pcs'],
    within: ['pcsDays', 'Certification Reminder Days'],
    action: 'remind',
    priority: 1,
    reason: 'A physician certification expires within {days}',
    message:
      "The physician certification for this patient's scheduled trips expires on {dueOn}. Get a new one before the next trip."
  }
];

const countDays = (g: Builder, id: string, label: string, days: Port) => {
  g.add(id, 'std.text.count', { label, values: { singular: 'day' } });
  g.wire(days, `${id}.count`);
  return `${id}.text` as const;
};

const DECISION_FIELDS = [
  { name: 'action', type: 'string' },
  { name: 'priority', type: 'integer' },
  { name: 'message', type: 'string' },
  { name: 'reason', type: 'string' }
] satisfies { name: string; type: ValueType }[];

const DECISION: ValueType = {
  object: Object.fromEntries(DECISION_FIELDS.map((f) => [f.name, f.type]))
};

const deadlineAction = (): GraphDef => {
  const g = rule(
    [d('deadline', DEADLINE, 'Deadline', 'One claim deadline coming up, with the days left.')],
    [
      d(
        'action',
        'string',
        'Action',
        "What to do: none, raise (raise the open task's priority) or remind (open a reminder task)."
      ),
      d('priority', 'integer', 'Priority', 'The priority to raise the task to or remind with.'),
      { ...MESSAGE_PIN, optional: true },
      d('reasons', { list: 'string' }, 'Reasons', 'Why this is done about the deadline.')
    ]
  );
  g.add('deadline', 'billing.deadline.break', { label: 'Deadline' });
  const acts = ACTS.map((a) => {
    const days = a.within && deadlineLimit(g, a.within[0], a.within[1]);
    const when = condition(
      g,
      a.id,
      a.label,
      {
        kind: ['string', 'deadline.kind'],
        daysLeft: ['integer', 'deadline.daysLeft'],
        ...(days ? { limitDays: ['integer', days] } : {}),
        ...(a.untilPriority === undefined
          ? { reminded: ['boolean', 'deadline.reminded'] }
          : { priority: ['integer', 'deadline.priority'] })
      },
      [
        { field: 'kind', op: 'oneOf', value: a.kinds },
        days
          ? { field: 'daysLeft', op: 'lte', input: 'limitDays' }
          : { field: 'daysLeft', op: 'lt', value: 0 },
        a.untilPriority === undefined
          ? { field: 'reminded', op: 'is', value: false }
          : { field: 'priority', op: 'lt', value: a.untilPriority }
      ]
    );
    const wired: Record<string, Port> = {};
    if (days && a.within) {
      wired.reason = template(g, `${a.id}Reason`, `${a.label}, Why`, a.reason, {
        days: countDays(g, `${a.id}Days`, `${a.within[1]} Text`, days)
      });
    }
    if (a.message) {
      wired.message = template(g, `${a.id}Text`, `${a.label}, Message`, a.message, {
        dueOn: 'deadline.dueOn'
      });
    }
    g.add(`${a.id}Decision`, 'std.object.make', {
      label: `${a.decision} Details`,
      config: { fields: DECISION_FIELDS },
      values: {
        action: a.action,
        priority: a.priority,
        ...(wired.reason ? {} : { reason: a.reason })
      }
    });
    for (const [pin, port] of Object.entries(wired)) g.wire(port, `${a.id}Decision.${pin}`);
    return { id: `${a.id}Case`, label: a.decision, when, value: `${a.id}Decision.object` as const };
  });
  const decided = firstOf(
    g,
    'decided',
    'First Deadline Case That Applies',
    DECISION,
    acts,
    fixed({ action: 'none', priority: 0, message: null, reason: 'Nothing is due soon' })
  );
  g.add('decision', 'std.object.break', {
    label: 'Action, Priority, Message and Why',
    config: { fields: DECISION_FIELDS }
  });
  g.ret('return');
  g.wire('entry.deadline', 'deadline.deadline');
  g.wire(decided, 'decision.object');
  g.wire('decision.action', 'return.action');
  g.wire('decision.priority', 'return.priority');
  g.wire('decision.message', 'return.message');
  g.wire(makeList(g, 'reasons', 'Reasons', 'string', ['decision.reason']), 'return.reasons');
  return g.def;
};

const FILING = listItem(T.filings);

const CERTIFICATION = listItem(T.certifications);

const DUE = listItem(T.dueDates);

const REMINDER = listItem(T.reminders);

const TASK_DUE = listItem(T.tasksDue);

const TODAY_PIN = d('today', 'string', 'Today', "Today's date at the agency (YYYY-MM-DD).");

const FILING_PIN = d(
  'filing',
  FILING,
  'Filing Facts',
  'A claim its next payer has not been billed for yet, with what sets its filing limit.'
);

const CERTIFICATION_PIN = d(
  'certification',
  CERTIFICATION,
  'Certification Facts',
  "A patient's last scheduled trip with a physician certification on file."
);

const DUE_PIN = d('due', DUE, 'Due Date', 'A claim deadline and the day it falls on.');

const KEY_PIN = d(
  'key',
  'string',
  'Reminder Key',
  'The deadline kind, whose deadline it is (the patient for a physician certification, else the claim) and the due date, as one text.'
);

const KEYS_PIN = d(
  'reminderKeys',
  { list: 'string' },
  'Reminder Keys',
  'The key of every deadline reminder already opened.'
);

const LATE_KEYS_PIN = d(
  'lateReminderKeys',
  { list: 'string' },
  'Reminder Keys Once Passed',
  'The keys of the reminders that still count once their date has passed: those opened after it, and every physician certification reminder.'
);

const DEADLINE_PIN = d(
  'deadline',
  DEADLINE,
  'Deadline',
  'One claim deadline, with the days left and whether a reminder was already opened.'
);

const daysAfter = (g: Builder, id: string, label: string, from: Port, days: Port) => {
  g.add(id, 'std.time.add', { label, config: { unit: 'days' } });
  g.add(`${id}Date`, 'std.time.parts', { label: `${label}, as a Date` });
  g.wire(from, `${id}.time`);
  g.wire(days, `${id}.amount`);
  g.wire(`${id}.time`, `${id}Date.time`);
  return `${id}Date.date` as const;
};

const filingLimit = (): GraphDef => {
  const g = rule(
    [FILING_PIN],
    [
      d('days', 'integer', 'Filing Limit Days', 'Days the payer allows to file the claim.', true),
      d('known', 'boolean', 'Limit Known', 'Whether the payer has a filing limit at all.')
    ]
  );
  g.add('filing', 'billing.filing-facts.break', { label: 'Filing' });
  g.add('federal', 'std.table.lookup', {
    label: 'Federal Filing Limit',
    config: { type: 'integer', table: { key: 'billing.federal-filing-limits' } }
  });
  orElse(
    g,
    'limit',
    'Directory Limit, Else Federal',
    'filing.filingLimitDays',
    'federal.value',
    'integer'
  );
  const known = condition(
    g,
    'known',
    'A Filing Limit Is Set',
    { days: ['integer', 'limit.value'] },
    [{ field: 'days', op: 'present' }]
  );
  g.ret('return');
  g.wire('entry.filing', 'filing.filing');
  g.wire('filing.claimFiling', 'federal.key');
  g.wire('limit.value', 'return.days');
  g.wire(known, 'return.known');
  return g.def;
};

const filingDeadline = (): GraphDef => {
  const g = rule([FILING_PIN], [DUE_PIN]);
  g.add('filing', 'billing.filing-facts.break', { label: 'Filing' });
  g.add('limit', 'billing.filing-limit', { label: 'Filing Limit' });
  g.add('due', 'billing.due-date.make', {
    label: 'Filing Due Date',
    values: { kind: 'timelyFiling', priority: 0 }
  });
  g.ret('return');
  g.wire('entry.filing', 'filing.filing', 'limit.filing');
  for (const f of ['claimId', 'patientId', 'reference', 'coverageId']) {
    g.wire(`filing.${f}`, `due.${f}`);
  }
  g.wire(
    daysAfter(g, 'dueOn', 'Service Date Plus the Limit', 'filing.serviceDate', 'limit.days'),
    'due.dueOn'
  );
  g.wire('due.due', 'return.due');
  return g.def;
};

const certificationInUse = (): GraphDef => {
  const g = rule(
    [CERTIFICATION_PIN, TODAY_PIN],
    [
      d(
        'inUse',
        'boolean',
        'In Use',
        'Whether the last scheduled trip was within the PCS Valid Days, so the certification still matters.'
      )
    ]
  );
  g.add('certification', 'billing.certification-facts.break', { label: 'Certification' });
  g.add('since', 'std.time.difference', {
    label: 'Days Since the Last Trip',
    config: { unit: 'days' }
  });
  g.add('recent', 'std.logic.less-or-equal', { label: 'Last Trip Within the PCS Valid Days' });
  g.ret('return');
  g.wire('entry.certification', 'certification.certification');
  g.wire('certification.serviceDate', 'since.start');
  g.wire('entry.today', 'since.end');
  g.wire('since.amount', 'recent.a');
  g.wire(checkLimit(g, 'validDays', 'pcsValidDays'), 'recent.b');
  g.wire('recent.result', 'return.inUse');
  return g.def;
};

const certificationDeadline = (): GraphDef => {
  const g = rule([CERTIFICATION_PIN], [DUE_PIN]);
  g.add('certification', 'billing.certification-facts.break', { label: 'Certification' });
  g.add('due', 'billing.due-date.make', {
    label: 'Certification Due Date',
    values: { kind: 'pcs', priority: 0 }
  });
  g.ret('return');
  g.wire('entry.certification', 'certification.certification');
  for (const f of ['claimId', 'patientId', 'reference']) {
    g.wire(`certification.${f}`, `due.${f}`);
  }
  g.wire(
    daysAfter(
      g,
      'dueOn',
      'Signed Date Plus the PCS Valid Days',
      'certification.signedOn',
      checkLimit(g, 'validDays', 'pcsValidDays')
    ),
    'due.dueOn'
  );
  g.wire('due.due', 'return.due');
  return g.def;
};

const deadlineKey = (): GraphDef => {
  const g = rule(
    [
      { ...KIND_PIN, optional: true },
      d('claimId', { id: 'claim' }, 'Claim', 'The claim the deadline is on.', true),
      d('patientId', { id: 'patient' }, 'Patient', 'The patient the claim is for.', true),
      d('dueOn', 'string', 'Due On', 'The due date (YYYY-MM-DD).', true)
    ],
    [KEY_PIN]
  );
  const perPatient = condition(
    g,
    'perPatient',
    'A Physician Certification',
    { kind: ['string', 'entry.kind'] },
    [{ field: 'kind', op: 'is', value: 'pcs' }]
  );
  const whose = select(
    g,
    'whose',
    'The Patient, Else the Claim',
    perPatient,
    'entry.patientId',
    'entry.claimId'
  );
  g.ret('return');
  g.wire(
    template(g, 'key', 'Reminder Key', '{kind} {whose} {dueOn}', {
      kind: 'entry.kind',
      whose,
      dueOn: 'entry.dueOn'
    }),
    'return.key'
  );
  return g.def;
};

const reminderKeys = (): GraphDef => {
  const g = rule(
    [d('reminder', REMINDER, 'Reminder Facts', 'A deadline reminder already opened.')],
    [
      KEY_PIN,
      d(
        'lateKey',
        'string',
        'Key Once Passed',
        'The key again when the reminder still counts once its date has passed: it was opened after that date, or it is for a physician certification.',
        true
      )
    ]
  );
  g.add('reminder', 'billing.reminder-facts.break', { label: 'Reminder' });
  g.add('key', 'billing.deadline-key', { label: 'Reminder Key' });
  g.add('openedLate', 'std.logic.greater', { label: 'Opened After the Due Date' });
  const certification = condition(
    g,
    'certification',
    'A Physician Certification',
    { kind: ['string', 'reminder.kind'] },
    [{ field: 'kind', op: 'is', value: 'pcs' }]
  );
  g.add('counts', 'std.logic.or', { label: 'Counts Once Passed' });
  const late = select(g, 'late', 'Key, If It Counts Once Passed', 'counts.result', 'key.key');
  g.ret('return');
  g.wire('entry.reminder', 'reminder.reminder');
  for (const f of ['kind', 'claimId', 'patientId', 'dueOn']) g.wire(`reminder.${f}`, `key.${f}`);
  g.wire('reminder.openedOn', 'openedLate.a');
  g.wire('reminder.dueOn', 'openedLate.b');
  g.wire(certification, 'counts.a');
  g.wire('openedLate.result', 'counts.b');
  g.wire('key.key', 'return.key');
  g.wire(late, 'return.lateKey');
  return g.def;
};

const TASK_KINDS_BY_WORKFLOW = shared.lookup(
  'billing.task-deadline-kinds',
  'Task Deadline Kinds',
  'Which kind of deadline the due date of an open task is, by the workflow that opened it: an appeal, a records request or a refund. Any other task is a task.',
  {
    type: 'string',
    rows: [
      { key: 'billing.work-denial', value: 'appeal' },
      { key: 'billing.log-records-request', value: 'records' },
      { key: 'billing.refund-overpayment', value: 'refund' }
    ],
    fallback: 'task'
  }
);

const taskDeadline = (): GraphDef => {
  const g = rule(
    [d('task', TASK_DUE, 'Task Due', 'An open task on a claim with a due date.')],
    [DUE_PIN]
  );
  g.add('task', 'billing.task-due.break', { label: 'Task' });
  g.add('kind', 'std.table.lookup', {
    label: 'Deadline Kind of the Workflow',
    config: TASK_KINDS_BY_WORKFLOW
  });
  g.add('due', 'billing.due-date.make', { label: 'Task Due Date' });
  g.ret('return');
  g.wire('entry.task', 'task.task');
  g.wire('task.workflow', 'kind.key');
  g.wire('kind.value', 'due.kind');
  for (const f of ['claimId', 'patientId', 'reference', 'dueOn', 'taskId', 'priority']) {
    g.wire(`task.${f}`, `due.${f}`);
  }
  g.wire('due.due', 'return.due');
  return g.def;
};

const DEADLINE_FIELDS = [
  'kind',
  'claimId',
  'patientId',
  'reference',
  'coverageId',
  'dueOn',
  'taskId',
  'priority'
];

const datedDeadline = (): GraphDef => {
  const g = rule([DUE_PIN, TODAY_PIN, KEYS_PIN, LATE_KEYS_PIN], [DEADLINE_PIN]);
  g.add('due', 'billing.due-date.break', { label: 'Due Date' });
  g.add('daysLeft', 'std.time.difference', { label: 'Days Left', config: { unit: 'days' } });
  g.add('key', 'billing.deadline-key', { label: 'Reminder Key' });
  g.add('notPassed', 'std.logic.greater-or-equal', { label: 'Due Today or Later' });
  g.add('reminded', 'std.list.contains', { label: 'A Reminder Was Opened' });
  g.add('remindedLate', 'std.list.contains', { label: 'A Reminder Counts Once Passed' });
  const reminded = select(
    g,
    'alreadyReminded',
    'Already Reminded',
    'notPassed.result',
    'reminded.result',
    'remindedLate.result'
  );
  g.add('deadline', 'billing.deadline.make', { label: 'Deadline' });
  g.ret('return');
  g.wire('entry.due', 'due.due');
  for (const f of DEADLINE_FIELDS) g.wire(`due.${f}`, `deadline.${f}`);
  for (const f of ['kind', 'claimId', 'patientId', 'dueOn']) g.wire(`due.${f}`, `key.${f}`);
  g.wire('entry.today', 'daysLeft.start', 'notPassed.b');
  g.wire('due.dueOn', 'daysLeft.end', 'notPassed.a');
  g.wire('entry.reminderKeys', 'reminded.list');
  g.wire('entry.lateReminderKeys', 'remindedLate.list');
  g.wire('key.key', 'reminded.item', 'remindedLate.item');
  g.wire('daysLeft.amount', 'deadline.daysLeft');
  g.wire(reminded, 'deadline.reminded');
  g.wire('deadline.deadline', 'return.deadline');
  return g.def;
};

const deadlineComingUp = (): GraphDef => {
  const g = rule(
    [DEADLINE_PIN],
    [
      d(
        'comingUp',
        'boolean',
        'Coming Up',
        'Whether the deadline is within the Look-Ahead Days, or has passed.'
      )
    ]
  );
  g.add('deadline', 'billing.deadline.break', { label: 'Deadline' });
  const within = condition(
    g,
    'within',
    'Within the Look-Ahead Days',
    {
      daysLeft: ['integer', 'deadline.daysLeft'],
      lookAheadDays: ['integer', deadlineLimit(g, 'lookAhead', 'Look-Ahead Days')]
    },
    [{ field: 'daysLeft', op: 'lte', input: 'lookAheadDays' }]
  );
  g.ret('return');
  g.wire('entry.deadline', 'deadline.deadline');
  g.wire(within, 'return.comingUp');
  return g.def;
};

const upcomingDeadlines = (): GraphDef => {
  const g = rule(
    [
      d(
        'filings',
        T.filings,
        'Filings',
        'Claims whose next payer is not billed yet, with what sets their filing limit.'
      ),
      d(
        'certifications',
        T.certifications,
        'Certifications',
        "Each patient's last scheduled trip with a physician certification on file."
      ),
      d(
        'tasks',
        T.tasksDue,
        'Task Due Dates',
        'Open tasks on claims, with their due dates and the workflow that opened them.'
      ),
      d('reminders', T.reminders, 'Reminders', 'Deadline reminders already opened.'),
      TODAY_PIN
    ],
    [
      d(
        'deadlines',
        T.deadlines,
        'Deadlines',
        'The claim deadlines coming up or passed, soonest first, with the days left and whether a reminder was already opened.'
      )
    ]
  );
  const each = (id: string, label: string, kind: string, config: Record<string, string>) =>
    g.add(id, `std.list.${kind}`, { label, config: { version: 1, ...config } });
  each('limited', 'Filings with a Limit', 'filter-rule', {
    rule: 'billing.filing-limit',
    item: 'filing',
    test: 'known'
  });
  each('filingDue', 'Filing Due Dates', 'map-rule', {
    rule: 'billing.filing-deadline',
    item: 'filing'
  });
  each('inUse', 'Certifications in Use', 'filter-rule', {
    rule: 'billing.certification-in-use',
    item: 'certification',
    test: 'inUse'
  });
  each('certificationDue', 'Certification Due Dates', 'map-rule', {
    rule: 'billing.certification-deadline',
    item: 'certification'
  });
  each('taskDue', 'Task Deadlines', 'map-rule', { rule: 'billing.task-deadline', item: 'task' });
  each('keys', 'Reminder Keys', 'map-rule', { rule: 'billing.reminder-keys', item: 'reminder' });
  g.add('due', 'std.list.join', {
    label: 'Every Due Date',
    config: { count: 3, type: DUE }
  });
  each('dated', 'Each with Days Left', 'map-rule', { rule: 'billing.dated-deadline', item: 'due' });
  each('comingUp', 'Coming Up', 'filter-rule', {
    rule: 'billing.deadline-coming-up',
    item: 'deadline',
    test: 'comingUp'
  });
  g.add('sorted', 'std.list.sort-by-field', { label: 'Soonest First', values: { field: 'dueOn' } });
  g.ret('return');
  g.wire('entry.filings', 'limited.list');
  g.wire('limited.list', 'filingDue.list');
  g.wire('entry.certifications', 'inUse.list');
  g.wire('entry.today', 'inUse.today', 'dated.today');
  g.wire('inUse.list', 'certificationDue.list');
  g.wire('entry.reminders', 'keys.list');
  g.wire('filingDue.due', 'due.list1');
  g.wire('entry.tasks', 'taskDue.list');
  g.wire('taskDue.due', 'due.list2');
  g.wire('certificationDue.due', 'due.list3');
  g.wire('due.list', 'dated.list');
  g.wire('keys.key', 'dated.reminderKeys');
  g.wire('keys.lateKey', 'dated.lateReminderKeys');
  g.wire('dated.deadline', 'comingUp.list');
  g.wire('comingUp.list', 'sorted.list');
  g.wire('sorted.list', 'return.deadlines');
  return g.def;
};

const watchDeadlines = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [],
    outputs: [d('checked', 'integer', 'Deadlines Checked', 'How many deadlines were looked at.')]
  });
  g.trigger({ kind: 'schedule', every: 'day', hour: 6 });
  g.add('today', 'billing.agency-today', { label: 'Today at the Agency' });
  g.add('back', 'std.math.subtract', { label: 'Days Back', values: { a: 0 } });
  g.wire(checkLimit(g, 'validDays', 'pcsValidDays'), 'back.b');
  g.wire(
    daysAfter(g, 'since', 'Today Less the PCS Valid Days', 'today.today', 'back.result'),
    'read.since'
  );
  g.add('read', 'billing.read-deadlines', { label: 'Read Deadlines' });
  g.add('find', 'billing.upcoming-deadlines', { label: 'Upcoming Deadlines' });
  g.add('each', 'std.flow.for-each', { label: 'Each Deadline' });
  g.add('act', 'billing.deadline-action', { label: 'Deadline Action' });
  g.add('route', 'std.flow.switch', { label: 'By Action', config: { cases: ['raise', 'remind'] } });
  g.add('raise', 'billing.raise-task', { label: 'Raise Task Priority' });
  g.add('deadline', 'billing.deadline.break', { label: 'Deadline' });
  const reminder = makeObject(g, 'reminder', 'Reminder Inputs', {
    claimId: [{ id: 'claim' }, 'deadline.claimId'],
    kind: ['string', 'deadline.kind'],
    dueOn: ['string', 'deadline.dueOn'],
    reference: ['string', 'deadline.reference'],
    message: ['string', 'act.message'],
    priority: ['integer', 'act.priority']
  });
  g.add('remind', 'std.flow.start-workflow', {
    label: 'Open a Reminder',
    config: { workflow: 'billing.deadline-reminder', version: 1 }
  });
  g.add('count', 'std.list.length', { label: 'How Many Deadlines' });
  g.ret('return');
  g.wire('entry.exec', 'today.exec');
  g.wire('today.then', 'read.exec');
  g.wire('read.then', 'each.exec');
  for (const f of ['filings', 'certifications', 'tasks', 'reminders'])
    g.wire(`read.${f}`, `find.${f}`);
  g.wire('today.today', 'find.today');
  g.wire('find.deadlines', 'each.list', 'count.list');
  g.wire('each.body', 'route.exec');
  g.wire('each.item', 'act.deadline', 'deadline.deadline');
  g.wire('act.action', 'route.value');
  g.wire('route.raise', 'raise.exec');
  g.wire('deadline.taskId', 'raise.taskId');
  g.wire('act.priority', 'raise.priority');
  g.wire('route.remind', 'remind.exec');
  g.wire(reminder, 'remind.inputs');
  g.wire('each.completed', 'return.exec');
  g.wire('count.length', 'return.checked');
  return g.def;
};

const deadlineReminder = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [
      p('claimId', { id: 'claim' }),
      KIND_PIN,
      d('dueOn', 'string', 'Due On', 'The due date (YYYY-MM-DD).'),
      d(
        'reference',
        'string',
        'Claim Reference',
        'The claim number and patient the reminder names.'
      ),
      MESSAGE_PIN,
      d('priority', 'integer', 'Priority', 'How urgent the reminder is.', true)
    ],
    outputs: []
  });
  g.add('follow', 'billing.follow-claim', { label: 'Show on the Claim' });
  const details = makeObject(g, 'details', 'Deadline Details', {
    deadline: ['string', 'entry.kind'],
    dueOn: ['string', 'entry.dueOn'],
    message: ['string', 'entry.message']
  });
  g.add('remind', 'std.human.task', {
    label: 'Deadline Coming Up',
    config: {
      title: 'Deadline coming up',
      queue: 'billing-followup',
      instructions:
        'A deadline on this claim is near or has passed; the details say which and when. Do what it asks with the matching task from Start Task on the claim, then mark it done.',
      outcomes: ['done'],
      hints: { done: 'Closes the reminder; it changes nothing on the claim.' }
    }
  });
  g.ret('done');
  g.wire('entry.exec', 'follow.exec');
  g.wire('entry.claimId', 'follow.claimId');
  g.wire('entry.dueOn', 'remind.due');
  g.wire('entry.message', 'remind.summary');
  g.wire('entry.reference', 'remind.subject');
  g.wire('entry.priority', 'remind.priority');
  g.wire(details, 'remind.context');
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
  g.trigger({ kind: 'schedule', every: 'month', hour: 7 });
  g.add('today', 'billing.agency-today', { label: 'Today at the Agency' });
  g.add('thisMonth', 'std.time.start-of', {
    label: 'Start of This Month',
    config: { unit: 'month' }
  });
  g.add('lastMonth', 'std.time.add', {
    label: 'Start of Last Month',
    config: { unit: 'months' },
    values: { amount: -1 }
  });
  g.add('period', 'std.time.parts', { label: 'Last Month' });
  g.add('issue', 'billing.issue-facility-invoices', { label: 'Issue Facility Invoices' });
  g.ret('return');
  g.wire('entry.exec', 'today.exec');
  g.wire('today.then', 'issue.exec');
  g.wire('today.today', 'thisMonth.time');
  g.wire('thisMonth.time', 'lastMonth.time');
  g.wire('lastMonth.time', 'period.time');
  g.wire('period.date', 'issue.period');
  g.wire('issue.then', 'return.exec');
  g.wire('issue.invoices', 'return.invoices');
  g.wire('issue.claims', 'return.claims');
  return g.def;
};

export const scheduleGraphs: SeedGraph[] = [
  asRule(
    'billing.filing-limit',
    'Filing Limit',
    'Gives the days a payer allows to file a claim: the filing limit the payer directory sets, or else the one the Federal Filing Limits table gives its claim filing indicator, if any.',
    filingLimit()
  ),
  asRule(
    'billing.filing-deadline',
    'Filing Deadline',
    'Works out when a claim must be filed with its next payer: the date of service plus the Filing Limit.',
    filingDeadline()
  ),
  asRule(
    'billing.certification-in-use',
    'Certification in Use',
    "Says whether a patient's physician certification still matters: their last scheduled trip was within the PCS Valid Days (Check Limits table).",
    certificationInUse()
  ),
  asRule(
    'billing.certification-deadline',
    'Certification Deadline',
    'Works out when a physician certification expires: the day it was signed plus the PCS Valid Days (Check Limits table).',
    certificationDeadline()
  ),
  asRule(
    'billing.task-deadline',
    'Task Deadline',
    'Gives the due date of an open task as a claim deadline, of the kind the Task Deadline Kinds table gives the workflow that opened it.',
    taskDeadline()
  ),
  asRule(
    'billing.deadline-key',
    'Deadline Key',
    'Names a deadline as its kind, whose it is and its due date, so a reminder can be matched to it: a physician certification belongs to the patient, every other deadline to its claim.',
    deadlineKey()
  ),
  asRule(
    'billing.reminder-keys',
    'Reminder Keys',
    'Gives the Deadline Key of a reminder already opened, and the key again when it still counts once its date has passed: it was opened after that date, or it is for a physician certification.',
    reminderKeys()
  ),
  asRule(
    'billing.dated-deadline',
    'Dated Deadline',
    'Adds the days left to a due date, and whether a reminder was already opened for it: one with its key before the date passes, and after it only one opened after the date, or any for a physician certification, so a passed filing limit is reminded once more.',
    datedDeadline()
  ),
  asRule(
    'billing.deadline-coming-up',
    'Within Look-Ahead',
    'Says whether a deadline is close enough to look at: within the Look-Ahead Days (Deadline Limits table), or passed.',
    deadlineComingUp()
  ),
  asRule(
    'billing.upcoming-deadlines',
    'Upcoming Deadlines',
    "Works out the agency's claim deadlines coming up: the filing limit of payers not billed yet (Filing Deadline), physician certifications of patients still on scheduled trips (Certification Deadline) and the due dates of open tasks (Task Deadline), each with the days left and whether a reminder was already opened (Dated Deadline), keeping those within the Look-Ahead Days, soonest first.",
    upcomingDeadlines()
  ),
  asRule(
    'billing.deadline-action',
    'Deadline Action',
    'Decides what to do about one claim deadline, taking the first case that applies, with the days from the Deadline Limits table: remind once the filing limit has passed (urgent) or is near (high), raise an open appeal, records request, refund or other task to urgent when due now and to high when due soon, remind when a physician certification is about to expire, or nothing.',
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
    "Checks the agency's claim deadlines every morning: the filing limit of payers not billed yet, the due dates of appeals, records requests and refunds, and expiring physician certifications of trips within the PCS Valid Days. Works them out (Upcoming Deadlines), then raises the open task or opens a reminder before they lapse (Deadline Action).",
    watchDeadlines()
  ),
  asWorkflow(
    'billing.invoice-facilities',
    'Invoice Facilities',
    "Issues last month's facility invoices: one PDF per facility for the trips it is responsible for with a balance left, logged in each claim's files. Started on the first of every month.",
    invoiceFacilities()
  )
];
