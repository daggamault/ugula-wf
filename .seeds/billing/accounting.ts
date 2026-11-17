import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  asRule,
  asWorkflow,
  type Builder,
  both,
  condition,
  d,
  firstOf,
  fixed,
  flow,
  listItem,
  makeList,
  makeObject,
  money,
  type Port,
  rule,
  shared,
  summary,
  T,
  template
} from './shared.ts';

const PAIR = listItem(T.depositPairs);

const RECONCILIATION_LIMITS = shared.lookup(
  'billing.reconciliation-limits',
  'Reconciliation Limits',
  'The numbers Watch Deposits works with. Days to Match: how many days a deposit can wait for its 835, or an 835 for its deposit, before a biller is asked to find the other.',
  { type: 'integer', rows: [{ key: 'Days to Match', value: 3 }] }
);

const depositMatch = (): GraphDef => {
  const g = rule(
    [d('pair', PAIR, 'Deposit Pair', 'An unmatched deposit and an unmatched 835 to compare.')],
    [
      d(
        'match',
        'string',
        'Match',
        'matched (the deposit is the payment of the 835), review (the trace numbers agree but the amounts do not) or none.'
      ),
      d('reasons', { list: 'string' }, 'Reasons', 'Why it matches or not.')
    ]
  );
  g.add('pair', 'billing.deposit-pair.break', { label: 'Deposit Pair' });
  const sameTrace = condition(
    g,
    'sameTrace',
    'Same Trace Number',
    {
      depositTrace: ['string', 'pair.depositTrace'],
      remittanceTrace: ['string', 'pair.remittanceTrace']
    },
    [{ field: 'depositTrace', op: 'is', input: 'remittanceTrace' }]
  );
  const sameAmount = condition(
    g,
    'sameAmount',
    'Same Amount',
    {
      depositCents: ['integer', 'pair.depositCents'],
      remittanceCents: ['integer', 'pair.remittanceCents']
    },
    [{ field: 'depositCents', op: 'is', input: 'remittanceCents' }]
  );
  const matched = both(g, 'matched', 'Same Trace Number and Amount', sameTrace, sameAmount);
  const decide = (id: string, label: string, matchedTo: string, reviewTo: string, none: string) =>
    firstOf(
      g,
      id,
      label,
      'string',
      [
        { id: `${id}Matched`, label: 'Matched', when: matched, value: fixed(matchedTo) },
        { id: `${id}Review`, label: 'Amounts Differ', when: sameTrace, value: fixed(reviewTo) }
      ],
      fixed(none)
    );
  g.ret('return');
  g.wire(
    decide('decided', 'First Match Case That Applies', 'matched', 'review', 'none'),
    'return.match'
  );
  g.wire(
    makeList(g, 'reasons', 'Reasons', 'string', [
      decide(
        'why',
        'Why',
        'The deposit has the trace number and amount of the 835',
        'The deposit has the trace number of the 835 but another amount',
        'The deposit and the 835 have different trace numbers'
      )
    ]),
    'return.reasons'
  );
  g.wire('entry.pair', 'pair.pair');
  return g.def;
};

const reconcile = (by: 'depositId' | 'payerFileId', event: string): GraphDef => {
  const g = flow(
    [
      by === 'depositId'
        ? d('depositId', { id: 'deposit' }, 'Deposit', 'The deposit recorded.')
        : d('payerFileId', { id: 'payerFile' }, 'Remittance File', 'The 835 applied.')
    ],
    [d('matched', 'integer', 'Pairs Compared', 'How many deposit and 835 pairs were compared.')]
  );
  g.trigger({ kind: 'event', event, where: {} });
  g.add('read', 'billing.read-deposit-pairs', { label: 'Read Deposit Pairs' });
  g.add('each', 'std.flow.for-each', { label: 'Each Pair' });
  g.add('pair', 'billing.deposit-pair.break', { label: 'Deposit Pair' });
  g.add('match', 'billing.deposit-match', { label: 'Deposit Match' });
  g.add('route', 'std.flow.switch', {
    label: 'By Match',
    config: { cases: ['matched', 'review'] }
  });
  g.add('save', 'billing.save-deposit-match', { label: 'Save Deposit Match' });
  g.add('review', 'std.human.task', {
    label: 'Check the Deposit Amount',
    config: {
      title: 'Check a deposit against its remittance',
      queue: 'billing-reconcile',
      instructions:
        'A deposit and an 835 share a trace number but not an amount; the details show both. Compare the bank deposit with the 835 (a provider adjustment or a split payment can explain it). Match them if the deposit is the payment of this 835, else keep them apart and correct the deposit.',
      outcomes: ['match', 'keepApart'],
      hints: {
        match: 'Matches the deposit to this 835.',
        keepApart: 'Leaves both unmatched; Watch Deposits asks again after the Days to Match.'
      }
    }
  });
  const depositAmount = money(g, 'depositAmount', 'Deposit Amount', 'pair.depositCents');
  const remittanceAmount = money(g, 'remittanceAmount', '835 Amount', 'pair.remittanceCents');
  g.wire('pair.depositTrace', 'review.subject');
  g.wire(
    makeObject(g, 'details', 'Deposit and 835', {
      traceNumber: ['string', 'pair.depositTrace'],
      deposited: ['string', depositAmount],
      paid: ['string', remittanceAmount],
      remittanceFile: ['string', 'pair.fileName'],
      payer: ['string', 'pair.payerName']
    }),
    'review.context'
  );
  summary(g, 'review', 'Deposit {deposited} but the 835 {file} pays {paid}', {
    deposited: depositAmount,
    file: 'pair.fileName',
    paid: remittanceAmount
  });
  g.add('count', 'std.list.length', { label: 'How Many Pairs' });
  g.ret('return');
  g.wire('entry.exec', 'read.exec');
  g.wire(`entry.${by}`, `read.${by}`);
  g.wire('read.then', 'each.exec');
  g.wire('read.pairs', 'each.list', 'count.list');
  g.wire('each.item', 'pair.pair', 'match.pair');
  g.wire('each.body', 'route.exec');
  g.wire('match.match', 'route.value');
  g.wire('route.matched', 'save.exec');
  g.wire('route.review', 'review.exec');
  g.wire('review.match', 'save.exec');
  g.wire('pair.depositId', 'save.depositId');
  g.wire('pair.payerFileId', 'save.payerFileId');
  g.wire('each.completed', 'return.exec');
  g.wire('count.length', 'return.matched');
  return g.def;
};

const unmatchedPayment = (): GraphDef => {
  const g = flow(
    [
      d('kind', 'string', 'Unmatched', 'What has no match: deposit or remittance.'),
      d('depositId', { id: 'deposit' }, 'Deposit', 'The deposit, for a deposit.', true),
      d('payerFileId', { id: 'payerFile' }, 'Remittance File', 'The 835, for a remittance.', true),
      d('traceNumber', 'string', 'Trace Number', 'The EFT or check trace number.'),
      d('amountCents', 'integer', 'Amount (Cents)', 'The amount, in cents.'),
      d('receivedOn', 'string', 'Received On', 'The day it came in (YYYY-MM-DD).'),
      d('payerName', 'string', 'Payer', 'The payer, when known.', true)
    ],
    []
  );
  g.add('route', 'std.flow.switch', {
    label: 'By What Is Unmatched',
    config: { cases: ['deposit', 'remittance'] }
  });
  const amount = money(g, 'amount', 'Amount', 'entry.amountCents');
  const details = makeObject(g, 'details', 'Payment Details', {
    traceNumber: ['string', 'entry.traceNumber'],
    amount: ['string', amount],
    receivedOn: ['string', 'entry.receivedOn'],
    payer: ['string', 'entry.payerName']
  });
  const task = (id: string, label: string, title: string, instructions: string, text: string) => {
    g.add(id, 'std.human.task', {
      label,
      config: {
        title,
        queue: 'billing-reconcile',
        instructions,
        outcomes: ['done'],
        hints: { done: 'Closes the task; it changes nothing.' }
      }
    });
    g.wire('entry.traceNumber', `${id}.subject`);
    g.wire(details, `${id}.context`);
    summary(g, id, text, { amount, on: 'entry.receivedOn' });
    g.wire(`route.${id}`, `${id}.exec`);
    g.wire(`${id}.done`, 'done.exec');
  };
  g.ret('done');
  task(
    'deposit',
    'Deposit Without a Remittance',
    'Deposit without a remittance',
    'This bank deposit has had no 835 with its trace number for the Days to Match (Reconciliation Limits table), so its claim payments are not posted. Find the 835 with the clearinghouse or the payer and upload it on Payer Files, or correct the deposit, then mark it done.',
    'A deposit of {amount} on {on} has no 835'
  );
  task(
    'remittance',
    'Remittance Without a Deposit',
    'Remittance without a deposit',
    'This 835 says the payer paid, but no deposit with its trace number was recorded within the Days to Match (Reconciliation Limits table). Check the bank account and record the deposit on Deposits, or ask the payer about the payment, then mark it done.',
    'An 835 of {amount} received {on} has no deposit'
  );
  g.wire('entry.exec', 'route.exec');
  g.wire('entry.kind', 'route.value');
  return g.def;
};

const daysBefore = (g: Builder, id: string, label: string, from: Port, days: Port) => {
  g.add(`${id}Back`, 'std.math.subtract', { label: `${label}, Days Back`, values: { a: 0 } });
  g.add(id, 'std.time.add', { label, config: { unit: 'days' } });
  g.add(`${id}Date`, 'std.time.parts', { label: `${label}, as a Date` });
  g.wire(days, `${id}Back.b`);
  g.wire(from, `${id}.time`);
  g.wire(`${id}Back.result`, `${id}.amount`);
  g.wire(`${id}.time`, `${id}Date.time`);
  return `${id}Date.date` as const;
};

const watchDeposits = (): GraphDef => {
  const g = flow(
    [],
    [
      d('deposits', 'integer', 'Deposits', 'How many deposits without a remittance were reported.'),
      d(
        'remittances',
        'integer',
        'Remittances',
        'How many remittances without a deposit were reported.'
      )
    ]
  );
  g.trigger({ kind: 'schedule', every: 'day', hour: 7 });
  g.add('today', 'billing.agency-today', { label: 'Today at the Agency' });
  g.add('days', 'std.table.lookup', {
    label: 'Days to Match',
    config: RECONCILIATION_LIMITS,
    values: { key: 'Days to Match' }
  });
  g.add('read', 'billing.read-unmatched-payments', { label: 'Read Unmatched Payments' });
  g.wire(
    daysBefore(g, 'before', 'Today Less the Days to Match', 'today.today', 'days.value'),
    'read.before'
  );
  const each = (id: string, label: string, list: Port) => {
    g.add(id, 'std.flow.for-each', { label });
    g.add(`${id}Task`, 'std.flow.start-workflow', {
      label: `${label}: Open a Task`,
      config: { workflow: 'billing.unmatched-payment', version: 1 }
    });
    g.add(`${id}Count`, 'std.list.length', { label: `How Many ${label}` });
    g.wire(list, `${id}.list`, `${id}Count.list`);
    g.wire(`${id}.body`, `${id}Task.exec`);
    g.wire(`${id}.item`, `${id}Task.inputs`);
  };
  each('deposits', 'Deposits', 'read.deposits');
  each('remittances', 'Remittances', 'read.remittances');
  g.ret('return');
  g.wire('entry.exec', 'today.exec');
  g.wire('today.then', 'read.exec');
  g.wire('read.then', 'deposits.exec');
  g.wire('deposits.completed', 'remittances.exec');
  g.wire('remittances.completed', 'return.exec');
  g.wire('depositsCount.length', 'return.deposits');
  g.wire('remittancesCount.length', 'return.remittances');
  return g.def;
};

const closePeriod = (): GraphDef => {
  const g = flow(
    [],
    [d('period', 'string', 'Period', 'The month closed, as its first day (YYYY-MM-01).')]
  );
  g.trigger({ kind: 'schedule', every: 'month', hour: 8 });
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
  g.add('totals', 'billing.read-period-totals', { label: 'Read Period Totals' });
  const amounts = {
    charges: money(g, 'charges', 'Charges', 'totals.chargesCents'),
    payments: money(g, 'payments', 'Payments', 'totals.paymentsCents'),
    refunds: money(g, 'refunds', 'Refunds', 'totals.refundsCents'),
    adjustments: money(g, 'adjustments', 'Adjustments', 'totals.adjustmentsCents'),
    writeOffs: money(g, 'writeOffs', 'Write-Offs', 'totals.writeOffsCents')
  };
  const month = template(g, 'month', 'Month', '{month}/{year}', {
    month: 'period.month',
    year: 'period.year'
  });
  g.add('task', 'std.human.task', {
    label: 'Close the Month',
    config: {
      title: 'Close the month',
      queue: 'billing-approvals',
      permission: 'claims:approve',
      instructions:
        "Last month's postings are added up in the details, by the day they were posted. Check them against the bank and the general ledger, then close the month: anything posted later with a date in it is posted to the next open month, so the month's reports stay as they are. A closed month cannot be reopened.",
      outcomes: ['close'],
      hints: { close: 'Closes the month for postings.' }
    }
  });
  g.wire(month, 'task.subject');
  g.wire(
    makeObject(g, 'details', 'Month Totals', {
      month: ['string', month],
      charges: ['string', amounts.charges],
      payments: ['string', amounts.payments],
      refunds: ['string', amounts.refunds],
      adjustments: ['string', amounts.adjustments],
      writeOffs: ['string', amounts.writeOffs]
    }),
    'task.context'
  );
  summary(
    g,
    'task',
    'Close {month}: payments {payments}, adjustments {adjustments}, write-offs {writeOffs}',
    {
      month,
      payments: amounts.payments,
      adjustments: amounts.adjustments,
      writeOffs: amounts.writeOffs
    }
  );
  g.add('close', 'billing.record-period-close', { label: 'Record Period Close' });
  g.ret('return');
  g.wire('entry.exec', 'today.exec');
  g.wire('today.today', 'thisMonth.time');
  g.wire('thisMonth.time', 'lastMonth.time');
  g.wire('lastMonth.time', 'period.time');
  g.wire('period.date', 'totals.period', 'close.period', 'return.period');
  g.wire('today.then', 'totals.exec');
  g.wire('totals.then', 'task.exec');
  g.wire('task.close', 'close.exec');
  g.wire('task.completedBy', 'close.closedBy');
  g.wire('close.then', 'return.exec');
  return g.def;
};

export const accountingGraphs: SeedGraph[] = [
  asRule(
    'billing.deposit-match',
    'Deposit Match',
    'Decides whether a bank deposit is the payment of an 835 (CAQH CORE EFT and ERA reassociation): matched when the trace number and amount agree, review when only the trace number does, else none.',
    depositMatch()
  ),
  asWorkflow(
    'billing.reconcile-deposit',
    'Reconcile Deposit',
    'Matches a deposit a biller recorded to the unmatched 835 with its trace number (Deposit Match), and asks a biller when the amounts differ. Starts on Deposit Recorded.',
    reconcile('depositId', 'deposit.recorded')
  ),
  asWorkflow(
    'billing.reconcile-remittance',
    'Reconcile Remittance',
    'Matches an 835 just applied to the unmatched deposit with its trace number (Deposit Match), and asks a biller when the amounts differ. Starts on Remittance File Applied.',
    reconcile('payerFileId', 'remittance.file_applied')
  ),
  asWorkflow(
    'billing.unmatched-payment',
    'Unmatched Payment',
    'A Deposit without a remittance or Remittance without a deposit task (queue billing-reconcile). Started by Watch Deposits.',
    unmatchedPayment()
  ),
  asWorkflow(
    'billing.watch-deposits',
    'Watch Deposits',
    'Every morning, opens an Unmatched Payment task for each deposit with no 835, and each paying 835 with no deposit, older than the Days to Match (Reconciliation Limits table), once each.',
    watchDeposits()
  ),
  asWorkflow(
    'billing.close-period',
    'Close Period',
    "On the first of every month, adds up last month's postings (Read Period Totals) and asks someone who may approve claims to close the month; closing it (Close Period) posts anything dated in it later to the next open month and emits Period Closed.",
    closePeriod()
  )
];
