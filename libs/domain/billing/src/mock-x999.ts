import { envelope, type MockOptions } from './mock-envelope.ts';
import type { Segment } from './x12.ts';

type Mock999Error = {
  segment: string;
  position: number;
  loop?: string;
  code: string;
  element?: { position: string; code: string };
};

type Mock999Transaction = {
  controlNumber: string;
  accepted: boolean;
  errors?: Mock999Error[];
};

type Mock999 = {
  groupControlNumber: string;
  functionalId?: string;
  transactionSetId?: string;
  version?: string;
  transactions: Mock999Transaction[];
  accepted?: boolean;
};

export const build999 = (ack: Mock999, o: MockOptions = {}) => {
  const version = ack.version ?? '005010X222A1';
  const transactionId = ack.transactionSetId ?? '837';
  const acceptedCount = ack.transactions.filter((t) => t.accepted).length;
  const groupStatus =
    ack.accepted === false
      ? 'R'
      : ack.accepted === true || acceptedCount === ack.transactions.length
        ? 'A'
        : acceptedCount
          ? 'P'
          : 'R';
  return envelope(o, { functional: 'FA', version: '005010X231A1' }, [
    {
      id: '999',
      version: '005010X231A1',
      body: [
        ['AK1', ack.functionalId ?? 'HC', ack.groupControlNumber, version],
        ...ack.transactions.flatMap((t): Segment[] => [
          ['AK2', transactionId, t.controlNumber, version],
          ...(t.errors ?? []).flatMap((e): Segment[] => [
            ['IK3', e.segment, String(e.position), e.loop ?? '', e.code],
            ...(e.element ? [['IK4', e.element.position, '', e.element.code]] : [])
          ]),
          ['IK5', t.accepted ? 'A' : 'R']
        ]),
        [
          'AK9',
          groupStatus,
          String(ack.transactions.length),
          String(ack.transactions.length),
          String(groupStatus === 'R' ? 0 : acceptedCount)
        ]
      ]
    }
  ]);
};
