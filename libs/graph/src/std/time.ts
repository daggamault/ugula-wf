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
    description: 'Outputs the current date and time, fixed for the current step so retries agree.',
    inputs: [],
    outputs: [pin('now', 'datetime')],
    compute: (_, __, ctx) => ({ now: ctx.now.toISOString() })
  }),
  pureNode<UnitConfig>({
    type: 'std.time.add',
    title: 'Add Time',
    category: CATEGORY,
    description: 'Adds an amount of a unit to a date or time.',
    config: unitConfig,
    inputs: [pin('time', 'datetime'), pin('amount', 'number')],
    outputs: [pin('time', 'datetime')],
    compute: ({ time, amount }, { unit }) => {
      const d = toDate(time);
      const n = amount as number;
      if (unit === 'years') d.setUTCFullYear(d.getUTCFullYear() + n);
      else if (unit === 'months') d.setUTCMonth(d.getUTCMonth() + n);
      else d.setTime(d.getTime() + n * UNIT_MS[unit]);
      return { time: d.toISOString() };
    }
  }),
  pureNode<UnitConfig>({
    type: 'std.time.difference',
    title: 'Time Between',
    category: CATEGORY,
    description: 'Whole units from start to end (negative if end is earlier).',
    config: unitConfig,
    inputs: [pin('start', 'datetime'), pin('end', 'datetime')],
    outputs: [pin('amount', 'integer')],
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
    description: 'Splits a date and time into year, month, day, hour and minute, in UTC.',
    inputs: [pin('time', 'datetime')],
    outputs: [
      pin('date', 'string'),
      pin('year', 'integer'),
      pin('month', 'integer'),
      pin('day', 'integer'),
      pin('weekday', 'integer'),
      pin('hour', 'integer'),
      pin('minute', 'integer')
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
    description: 'Whole years from birth date to a date (defaults to now).',
    inputs: [pin('birthDate', 'datetime'), pin('at', 'datetime', { optional: true })],
    outputs: [pin('years', 'integer')],
    compute: ({ birthDate, at }, _, ctx) => ({
      years: ageAt(toDate(birthDate), at === null ? ctx.now : toDate(at))
    })
  })
];
