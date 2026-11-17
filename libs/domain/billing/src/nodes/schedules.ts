import { actionNode, isIsoDate, pin } from '@ugula/graph';
import { invoiceTotal, renderFacilityInvoice } from '../documents.ts';
import { CERTIFICATION_FACTS, FILING_FACTS, REMINDER_FACTS, TASK_DUE } from '../ledger-models.ts';
import { requiredText } from '../values.ts';
import type { NodesOf } from './stores.ts';

const CATEGORY = 'Billing';

const PERIOD = /^\d{4}-\d{2}-01$/;

export const scheduleNodes: NodesOf = (stores) => {
  const schedules = () => stores().schedules;
  const today = (runId: string, at: Date) => stores().calendar.today(runId, at);
  return [
    actionNode({
      type: 'billing.agency-today',
      title: 'Agency Today',
      category: CATEGORY,
      description:
        "Gives today's date (YYYY-MM-DD) in the agency's time zone from its billing profile, or in UTC without one.",
      level: 'basic',
      keywords: ['date', 'today', 'time zone'],
      inputs: [],
      outputs: [
        pin('today', 'string', {
          label: 'Today',
          description: "Today's date in the agency's time zone (YYYY-MM-DD)."
        })
      ],
      compute: async (_, __, ctx) => ({ today: await today(ctx.runId, ctx.now) })
    }),
    actionNode({
      type: 'billing.read-deadlines',
      title: 'Read Deadlines',
      category: CATEGORY,
      description:
        "Reads what the agency's claim deadlines are worked out from: claims whose next payer is not billed yet, with that payer's claim filing indicator, the filing limit the payer directory sets and the date of service; each patient's last scheduled trip with a physician certification on file, among trips on or after a date; open tasks with a due date and the workflow that opened them; and the deadline reminders already opened. Decides nothing; Upcoming Deadlines does.",
      level: 'basic',
      keywords: ['timely filing', 'due date', 'reminder', 'deadline'],
      inputs: [
        pin('since', 'string', {
          label: 'Trips Since',
          description:
            'The earliest scheduled trip whose physician certification is read (YYYY-MM-DD).'
        })
      ],
      outputs: [
        pin(
          'filings',
          { list: FILING_FACTS.type },
          {
            description:
              'Claims whose next payer is not billed yet, with what sets their filing limit.'
          }
        ),
        pin(
          'certifications',
          { list: CERTIFICATION_FACTS.type },
          {
            description:
              "Each patient's last scheduled trip since the date with a physician certification on file, and when it was signed."
          }
        ),
        pin(
          'tasks',
          { list: TASK_DUE.type },
          {
            label: 'Task Due Dates',
            description:
              'Open tasks on claims other than deadline reminders, with their due dates and the workflow that opened them.'
          }
        ),
        pin(
          'reminders',
          { list: REMINDER_FACTS.type },
          {
            description: 'Deadline reminders already opened, open or done.'
          }
        )
      ],
      compute: async ({ since }, __, ctx) => {
        if (!isIsoDate(since)) throw new Error(`${since} is not a date`);
        return schedules().deadlineFacts(ctx.runId, since);
      }
    }),
    actionNode({
      type: 'billing.raise-task',
      title: 'Raise Task Priority',
      category: CATEGORY,
      description:
        'Raises an open task to a priority, so it is handed out before others; a task already at or above it is left alone.',
      level: 'basic',
      keywords: ['priority', 'urgent', 'task'],
      effect: true,
      inputs: [
        pin('taskId', { id: 'task' }, { label: 'Task', description: 'The open task to raise.' }),
        pin('priority', 'integer', { description: 'The priority to raise the task to.' })
      ],
      outputs: [],
      compute: async (inputs, _, ctx) => {
        await schedules().raiseTask(
          ctx.runId,
          requiredText(inputs.taskId, 'No task to raise'),
          inputs.priority
        );
        return {};
      }
    }),
    actionNode({
      type: 'billing.issue-facility-invoices',
      title: 'Issue Facility Invoices',
      category: CATEGORY,
      description:
        'Renders one PDF invoice per facility for the month starting on the period: every trip through that month the facility is responsible for with a balance left that no invoice to it has billed yet, so trips added late go on a supplemental invoice. Stores each, and logs it in the files of each claim it bills, once per step.',
      level: 'basic',
      keywords: ['invoice', 'facility billing', 'monthly'],
      effect: true,
      inputs: [
        pin('period', 'string', {
          label: 'First Day of the Month',
          description: 'The month to invoice, as its first day (YYYY-MM-01).'
        })
      ],
      outputs: [
        pin('invoices', 'integer', { description: 'How many invoices were issued.' }),
        pin('claims', 'integer', { description: 'How many claims the invoices bill.' })
      ],
      compute: async (inputs, _, ctx) => {
        const period = requiredText(inputs.period, 'No month to invoice');
        if (!PERIOD.test(period)) throw new Error(`${period} is not the first day of a month`);
        const sources = await schedules().facilityInvoices(ctx.runId, period);
        const issuedOn = await today(ctx.runId, ctx.now);
        for (const source of sources) {
          await schedules().saveFacilityInvoice(ctx.runId, `${ctx.key}:${source.facilityId}`, {
            source,
            pdf: await renderFacilityInvoice(source, issuedOn),
            totalCents: invoiceTotal(source.claims)
          });
        }
        return {
          invoices: sources.length,
          claims: sources.reduce((sum, s) => sum + s.claims.length, 0)
        };
      }
    })
  ];
};
