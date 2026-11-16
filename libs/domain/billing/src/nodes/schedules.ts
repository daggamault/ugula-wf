import { actionNode, pin } from '@ugula/graph';
import { invoiceTotal, renderFacilityInvoice } from '../documents.ts';
import { DEADLINE } from '../ledger-models.ts';
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
      type: 'billing.find-deadlines',
      title: 'Find Deadlines',
      category: CATEGORY,
      description:
        "Lists the agency's claim deadlines coming up as of today: timely filing for payers not billed yet, the due dates of open appeal, records request and refund tasks, and physician certifications about to expire for patients on scheduled trips, each with the days left and whether a reminder was already opened for that deadline (per patient for certifications, and once more after a filing limit passes). Decides nothing; Deadline Action does.",
      level: 'basic',
      keywords: ['timely filing', 'due date', 'reminder', 'deadline'],
      inputs: [],
      outputs: [
        pin(
          'deadlines',
          { list: DEADLINE.type },
          {
            description: 'The claim deadlines coming up, with the days left.'
          }
        )
      ],
      compute: async (_, __, ctx) => ({
        deadlines: await schedules().deadlines(ctx.runId, await today(ctx.runId, ctx.now))
      })
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
