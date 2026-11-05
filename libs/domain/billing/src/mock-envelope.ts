import { clean, MAX_CONTROL_NUMBER, type Segment } from './x12.ts';

export type MockOptions = {
  sender?: string;
  receiver?: string;
  production?: boolean;
  controlNumber?: number;
  createdAt?: Date;
};

export type Transaction = { id: string; version: string; body: Segment[] };

export type Party = { name: string; id: string };

export const DEFAULT_SENDER = 'DEMOCH';

export const DEFAULT_RECEIVER = 'DEVEMS01';

export const DEFAULT_PROVIDER: Party = { name: 'DEVELOPMENT EMS', id: '1234567893' };

export const DEFAULT_PAYER: Party = { name: 'MEDICARE', id: 'DEMOMCR' };

const safe = (x: string) => x.replace(/[^\x20-\x7E]/g, '').replace(/[~*:^]/g, ' ');

const serialize = (seg: Segment) =>
  `${seg
    .map((el) => (typeof el === 'string' ? safe(el) : el.map(safe).join(':')))
    .join('*')
    .replace(/\*+$/, '')}~`;

export const randomControl = () => Math.floor(Math.random() * (MAX_CONTROL_NUMBER - 1)) + 1;

export const mockDollars = (cents: number) => (cents / 100).toFixed(2);

export const stamp = (o: MockOptions) => {
  const iso = (o.createdAt ?? new Date()).toISOString();
  return {
    date: iso.slice(0, 10).replaceAll('-', ''),
    time: iso.slice(11, 16).replace(':', '')
  };
};

export const envelope = (
  o: MockOptions,
  group: { functional: string; version: string },
  transactions: Transaction[]
) => {
  const control = o.controlNumber ?? randomControl();
  if (!Number.isInteger(control) || control < 1 || control > MAX_CONTROL_NUMBER) {
    throw new Error(`Control number ${control} is out of range`);
  }
  const { date, time } = stamp(o);
  const sender = clean(o.sender ?? DEFAULT_SENDER, 15);
  const receiver = clean(o.receiver ?? DEFAULT_RECEIVER, 15);
  const padded = String(control).padStart(9, '0');
  const isa = [
    'ISA',
    '00',
    ' '.repeat(10),
    '00',
    ' '.repeat(10),
    'ZZ',
    sender.padEnd(15),
    'ZZ',
    receiver.padEnd(15),
    date.slice(2),
    time,
    '^',
    '00501',
    padded,
    '0',
    o.production ? 'P' : 'T',
    ':'
  ].join('*');
  const segments: Segment[] = [
    ['GS', group.functional, sender, receiver, date, time, String(control), 'X', group.version],
    ...transactions.flatMap((t, i): Segment[] => {
      const st = String(i + 1).padStart(4, '0');
      return [['ST', t.id, st, t.version], ...t.body, ['SE', String(t.body.length + 2), st]];
    }),
    ['GE', String(transactions.length), String(control)],
    ['IEA', '1', padded]
  ];
  return `${[`${isa}~`, ...segments.map(serialize)].join('\n')}\n`;
};
