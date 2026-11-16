import * as v from 'valibot';
import { pin, pureNode } from '../define.ts';
import { ageAt } from '../expr-functions.ts';
import type { NodeDef } from '../types.ts';

const CATEGORY = 'Time';
const UNIT_MS = { days: 86_400_000, hours: 3_600_000, minutes: 60_000, seconds: 1000 } as const;

const unitConfig = v.object({
  unit: v.optional(v.picklist(['years', 'months', 'days', 'hours', 'minutes', 'seconds']), 'days')
});

type UnitConfig = v.InferOutput<typeof unitConfig>;

const toDate = (x: unknown) => new Date(x as string);

const intoMonth = (d: Date) => d.getTime() - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);

const addMonths = (d: Date, n: number) => {
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
};

const monthsBetween = (a: Date, b: Date) => {
  const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  if (months > 0 && intoMonth(b) < intoMonth(a)) return months - 1;
  if (months < 0 && intoMonth(b) > intoMonth(a)) return months + 1;
  return months;
};

export const timeNodes: NodeDef[] = [
  pureNode({
    type: 'std.time.now',
    title: 'Now',
    category: CATEGORY,
    description: 'The current date and time, the same for every retry of a step.',
    level: 'basic',
    keywords: ['time', 'date', 'today', 'current'],
    inputs: [],
    outputs: [pin('now', 'datetime', { description: 'The current date and time.' })],
    compute: (_, __, ctx) => ({ now: ctx.now.toISOString() })
  }),
  pureNode<UnitConfig>({
    type: 'std.time.add',
    title: 'Add Time',
    category: CATEGORY,
    description: 'Adds an amount of days, months or another unit to a date and time.',
    level: 'basic',
    keywords: ['time', 'date', 'add', 'later', 'earlier'],
    summary: ({ unit }) => `Adds ${unit}`,
    config: unitConfig,
    inputs: [
      pin('time', 'datetime', { description: 'The date and time to start from.' }),
      pin('amount', 'number', { description: 'How many units to add; negative goes back.' })
    ],
    outputs: [pin('time', 'datetime', { description: 'The new date and time.' })],
    compute: ({ time, amount }, { unit }) => {
      const d = toDate(time);
      const n = amount as number;
      if (unit === 'years') addMonths(d, n * 12);
      else if (unit === 'months') addMonths(d, n);
      else d.setTime(d.getTime() + n * UNIT_MS[unit]);
      return { time: d.toISOString() };
    }
  }),
  pureNode<UnitConfig>({
    type: 'std.time.difference',
    title: 'Time Between',
    category: CATEGORY,
    description:
      'Counts the whole days, months or other units from a start to an end; negative when the end is earlier.',
    level: 'basic',
    keywords: ['time', 'date', 'difference', 'days', 'between'],
    summary: ({ unit }) => `In ${unit}`,
    config: unitConfig,
    inputs: [
      pin('start', 'datetime', { description: 'The start.' }),
      pin('end', 'datetime', { description: 'The end.' })
    ],
    outputs: [pin('amount', 'integer', { description: 'How many whole units lie between.' })],
    compute: ({ start, end }, { unit }) => {
      const [a, b] = [toDate(start), toDate(end)];
      const amount =
        unit === 'years'
          ? Math.trunc(monthsBetween(a, b) / 12)
          : unit === 'months'
            ? monthsBetween(a, b)
            : Math.trunc((b.getTime() - a.getTime()) / UNIT_MS[unit]);
      return { amount };
    }
  }),
  pureNode({
    type: 'std.time.parts',
    title: 'Date Parts',
    category: CATEGORY,
    description: 'Splits a date and time into its year, month, day, hour and minute, in UTC.',
    level: 'basic',
    keywords: ['time', 'date', 'year', 'month', 'day'],
    inputs: [pin('time', 'datetime', { description: 'The date and time to split.' })],
    outputs: [
      pin('date', 'string', { description: 'The date, as YYYY-MM-DD.' }),
      pin('year', 'integer', { description: 'The year.' }),
      pin('month', 'integer', { description: 'The month, 1 to 12.' }),
      pin('day', 'integer', { description: 'The day of the month.' }),
      pin('weekday', 'integer', { description: 'The day of the week, 0 for Sunday to 6.' }),
      pin('hour', 'integer', { description: 'The hour, 0 to 23.' }),
      pin('minute', 'integer', { description: 'The minute.' })
    ],
    compute: ({ time }) => {
      const d = toDate(time);
      return {
        date: d.toISOString().slice(0, 10),
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
        weekday: d.getUTCDay(),
        hour: d.getUTCHours(),
        minute: d.getUTCMinutes()
      };
    }
  }),
  pureNode({
    type: 'std.time.age',
    title: 'Age',
    category: CATEGORY,
    description: 'How old someone is, in whole years, on a date or today.',
    level: 'basic',
    keywords: ['age', 'birth', 'years', 'old'],
    inputs: [
      pin('birthDate', 'datetime', { description: 'The birth date.' }),
      pin('at', 'datetime', {
        optional: true,
        description: 'The date to work the age out on; today when empty.'
      })
    ],
    outputs: [pin('years', 'integer', { description: 'The age in whole years.' })],
    compute: ({ birthDate, at }, _, ctx) => ({
      years: ageAt(toDate(birthDate), at === null ? ctx.now : toDate(at))
    })
  })
];
