const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const formatDateTime = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : '—');

const localDay = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export const formatDay = (iso: string | null) => (iso ? localDay.format(new Date(iso)) : '—');

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

const miles = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export const formatMiles = (value: string | number) => {
  const n = Number(value);
  return Number.isFinite(n) ? `${miles.format(n)} ${n === 1 ? 'mile' : 'miles'}` : '—';
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

const MINOR_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'but',
  'or',
  'nor',
  'as',
  'of',
  'to',
  'in',
  'on',
  'for',
  'at',
  'by',
  'from',
  'per',
  'via',
  'vs',
  'with'
]);

const SPECIAL_WORDS: ReadonlyMap<string, string> = new Map(
  [
    'ALS',
    'ALS1',
    'ALS2',
    'API',
    'BLS',
    'CMS',
    'CRC',
    'CSV',
    'DOB',
    'EMS',
    'GNIS',
    'HCPCS',
    'ICD',
    'ID',
    'IDs',
    'IO',
    'IV',
    'JSON',
    'NEMSIS',
    'NPI',
    'PCR',
    'PCRs',
    'PCS',
    'PDF',
    'PSAP',
    'SCT',
    'SSN',
    'URL',
    'UUID',
    'X12',
    'X837',
    'XML',
    'ZIP',
    '837P'
  ].map((w) => [w.toLowerCase(), w])
);

const LOWER_UNITS = new Set(['kg', 'lb', 'lbs', 'ms']);

const casePart = (part: string, minor: boolean) => {
  const [, lead = '', core = '', trail = ''] =
    /^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/.exec(part) ?? [];
  const lower = core.toLowerCase();
  const cased =
    SPECIAL_WORDS.get(lower) ??
    (/[A-Z]/.test(core.slice(1)) || LOWER_UNITS.has(core) || (minor && MINOR_WORDS.has(lower))
      ? core
      : core.charAt(0).toUpperCase() + core.slice(1));
  return lead + cased + trail;
};

export const titleCaseLabel = (label: string) =>
  label
    .split(' ')
    .map((word, i, words) =>
      word
        .split(/([/-])/)
        .map((part, j) => (j % 2 ? part : casePart(part, i > 0 && i < words.length - 1 && j === 0)))
        .join('')
    )
    .join(' ');

export const titleCaseWords = (words: readonly string[]) =>
  titleCaseLabel(words.map((w) => w.toLowerCase()).join(' '));

const UNIT_SUFFIX = new Set(['cents', 'ms', 'kg']);

export const labelFromName = (name: string) => {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .flatMap((w) => {
      const lower = w.toLowerCase();
      return SPECIAL_WORDS.has(lower)
        ? [lower]
        : lower.replace(/([a-z]{2,})(\d)/g, '$1 $2').split(' ');
    });
  const last = words.at(-1);
  if (words.length > 1 && last && UNIT_SUFFIX.has(last)) words[words.length - 1] = `(${last})`;
  return words.length ? titleCaseLabel(words.join(' ')) : name;
};
