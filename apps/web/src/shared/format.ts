const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const formatDateTime = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : '—');

const calendarDay = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });

export const formatDate = (day: string | null) =>
  day ? calendarDay.format(new Date(`${day.slice(0, 10)}T00:00:00Z`)) : '—';

export const formatDuration = (ms: number) =>
  ms < 1 ? '<1 ms' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export const formatCents = (cents: number) => money.format(cents / 100);

export const parseDollars = (text: string) => {
  const amount = Number(text);
  return text.trim() !== '' && Number.isFinite(amount) && amount >= 0
    ? Math.round(amount * 100)
    : null;
};

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000]
];

export const formatAgo = (iso: string | null, now: Date = new Date()) => {
  if (!iso) return '—';
  const elapsed = now.getTime() - Date.parse(iso);
  const [unit, size] = UNITS.find(([, ms]) => elapsed >= ms) ?? ['minute', 60_000];
  return relative.format(-Math.floor(elapsed / size), unit);
};
