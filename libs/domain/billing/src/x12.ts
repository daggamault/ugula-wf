export type InboundKind = '835' | '999' | '277' | '271';

export type X12File = {
  kind: InboundKind | null;
  controlNumber: string | null;
  component: string;
  segments: string[][];
};

type Element = string | readonly string[];

export type Segment = readonly Element[];

export type Envelope = { controlNumber: number; createdAt: Date };

type Parties = { sender: string | null; receiver: string | null; production: boolean };

export const MAX_CONTROL_NUMBER = 999_999_999;

const INBOUND: readonly string[] = ['835', '999', '277', '271'];

const ISA_LENGTH = 106;

export const readX12 = (text: string): X12File => {
  const start = text.indexOf('ISA');
  if (start < 0 || text.length < start + ISA_LENGTH) throw new Error('Not an X12 file');
  const separator = text.charAt(start + 3);
  const component = text.charAt(start + 104);
  const terminator = text.charAt(start + 105);
  const segments = text
    .slice(start)
    .split(terminator)
    .map((s) => s.replace(/^[\r\n]+|[\r\n]+$/g, ''))
    .filter((s) => s.trim() !== '')
    .map((s) => s.split(separator));
  const [isa] = segments;
  if (isa?.[0] !== 'ISA') throw new Error('Not an X12 file');
  const st = segments.find((s) => s[0] === 'ST')?.[1] ?? '';
  return {
    kind: INBOUND.includes(st) ? (st as InboundKind) : null,
    controlNumber: isa[13]?.trim() || null,
    component,
    segments
  };
};

export const componentsOf = (element: string | undefined, file: X12File) =>
  (element ?? '').split(file.component);

export const transactionsOf = (file: X12File, kind: string) => {
  const sets: string[][][] = [];
  let current: string[][] | null = null;
  for (const seg of file.segments) {
    if (seg[0] === 'ST') current = seg[1] === kind ? [] : null;
    if (current) current.push(seg);
    if (seg[0] === 'SE' && current) {
      sets.push(current);
      current = null;
    }
  }
  return sets;
};

export const centsOf = (x: string | undefined) => {
  const n = Number(x);
  return x && Number.isFinite(n) ? Math.sign(n) * Math.round(Math.abs(n) * 100) : 0;
};

export const dateOf = (x: string | undefined) =>
  x && /^\d{8}$/.test(x) ? `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}` : null;

export const textOf = (x: string | undefined) => x?.trim() || null;

export const clean = (x: string | null | undefined, max = 60) =>
  (x ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[~*:^]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trimEnd()
    .toUpperCase();

const safe = (x: string) => x.replace(/[^\x20-\x7E]/g, '').replace(/[~*:^]/g, ' ');

const fixed = (x: string | null, n: number) => clean(x, n).padEnd(n, ' ');

const serialize = (seg: Segment) =>
  `${seg
    .map((el) => (typeof el === 'string' ? safe(el) : el.map(safe).join(':')))
    .join('*')
    .replace(/\*+$/, '')}~`;

export const yyyymmdd = (date: string) => date.slice(0, 10).replaceAll('-', '');

export const stampOf = (e: Envelope) => {
  if (
    !Number.isInteger(e.controlNumber) ||
    e.controlNumber < 1 ||
    e.controlNumber > MAX_CONTROL_NUMBER
  ) {
    throw new Error(`Control number ${e.controlNumber} is out of range`);
  }
  const iso = e.createdAt.toISOString();
  return {
    date: iso.slice(0, 10).replaceAll('-', ''),
    time: iso.slice(11, 16).replace(':', ''),
    control: String(e.controlNumber).padStart(9, '0')
  };
};

export const interchange = (
  p: Parties,
  e: Envelope,
  group: { functional: string; version: string },
  body: Segment[]
) => {
  const { date, time, control } = stampOf(e);
  const sender = clean(p.sender, 15);
  const receiver = clean(p.receiver, 15);
  const isa = [
    'ISA',
    '00',
    fixed('', 10),
    '00',
    fixed('', 10),
    'ZZ',
    fixed(sender, 15),
    'ZZ',
    fixed(receiver, 15),
    date.slice(2),
    time,
    '^',
    '00501',
    control,
    '0',
    p.production ? 'P' : 'T',
    ':'
  ];
  const segments: Segment[] = [
    [
      'GS',
      group.functional,
      sender,
      receiver,
      date,
      time,
      String(e.controlNumber),
      'X',
      group.version
    ],
    ...body,
    ['SE', String(body.length + 1), '0001'],
    ['GE', '1', String(e.controlNumber)],
    ['IEA', '1', control]
  ];
  return `${[`${isa.join('*')}~`, ...segments.map(serialize)].join('\n')}\n`;
};
