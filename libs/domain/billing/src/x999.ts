import { componentsOf, readX12, textOf, transactionsOf, type X12File } from './x12.ts';

export type TransactionAcknowledgment = {
  controlNumber: string;
  accepted: boolean;
  errors: string[];
};

export type GroupAcknowledgment = {
  groupControlNumber: string;
  accepted: boolean;
  transactions: TransactionAcknowledgment[];
};

const SEGMENT_ERRORS: Readonly<Record<string, string>> = {
  '1': 'Unrecognized segment ID',
  '2': 'Unexpected segment',
  '3': 'Required segment missing',
  '4': 'Loop occurs over maximum times',
  '5': 'Segment exceeds maximum use',
  '6': 'Segment not in defined transaction set',
  '7': 'Segment not in proper sequence',
  '8': 'Segment has data element errors',
  I4: 'Segment the implementation does not use is present',
  I6: 'Implementation dependent segment missing',
  I7: 'Implementation loop occurs under minimum times',
  I8: 'Implementation segment below minimum use',
  I9: 'Implementation dependent segment the implementation does not use is present'
};

const ELEMENT_ERRORS: Readonly<Record<string, string>> = {
  '1': 'Required data element missing',
  '2': 'Conditional required data element missing',
  '3': 'Too many data elements',
  '4': 'Data element too short',
  '5': 'Data element too long',
  '6': 'Invalid character in data element',
  '7': 'Invalid code value',
  '8': 'Invalid date',
  '9': 'Invalid time',
  '10': 'Exclusion condition violated',
  '12': 'Too many repetitions',
  '13': 'Too many components',
  I6: 'Code value not used in the implementation',
  I9: 'Implementation dependent data element missing',
  I10: 'Data element the implementation does not use is present',
  I11: 'Implementation too few repetitions',
  I12: 'Implementation pattern match failure',
  I13: 'Implementation dependent data element the implementation does not use is present'
};

const ACCEPTED = ['A', 'E'];

const described = (codes: Readonly<Record<string, string>>, code: string | undefined) =>
  code ? (codes[code] ?? `Error ${code}`) : 'Error without a code';

const segmentError = (ik3: string[]) =>
  `Segment ${ik3[1] ?? '?'} at position ${ik3[2] ?? '?'}${ik3[3] ? ` in loop ${ik3[3]}` : ''}: ${described(SEGMENT_ERRORS, ik3[4])}`;

const elementError = (ik4: string[], file: X12File) => {
  const [position, component] = componentsOf(ik4[1], file);
  const bad = textOf(ik4[4]);
  return `Element ${position ?? '?'}${component ? `-${component}` : ''}${ik4[2] ? ` (${ik4[2]})` : ''}: ${described(ELEMENT_ERRORS, ik4[3])}${bad ? ` "${bad}"` : ''}`;
};

const contextOf = (ctx: string[], file: X12File) => {
  const [name, value] = componentsOf(ctx[1], file);
  return `Context ${[name, value].filter(Boolean).join(' ')}`;
};

const groupsOf = (segments: string[][], file: X12File) => {
  const groups: GroupAcknowledgment[] = [];
  let group: GroupAcknowledgment | null = null;
  let transaction: TransactionAcknowledgment | null = null;
  for (const seg of segments) {
    switch (seg[0]) {
      case 'AK1':
        group = { groupControlNumber: seg[2]?.trim() ?? '', accepted: false, transactions: [] };
        groups.push(group);
        break;
      case 'AK2':
        transaction = { controlNumber: seg[2]?.trim() ?? '', accepted: false, errors: [] };
        group?.transactions.push(transaction);
        break;
      case 'IK3':
        transaction?.errors.push(segmentError(seg));
        break;
      case 'IK4':
        transaction?.errors.push(elementError(seg, file));
        break;
      case 'CTX':
        transaction?.errors.push(contextOf(seg, file));
        break;
      case 'IK5':
        if (transaction) transaction.accepted = ACCEPTED.includes(seg[1] ?? '');
        transaction = null;
        break;
      case 'AK9':
        if (group) group.accepted = ACCEPTED.includes(seg[1] ?? '');
        break;
    }
  }
  return groups;
};

export const read999 = (text: string): GroupAcknowledgment[] => {
  const file = readX12(text);
  return transactionsOf(file, '999').flatMap((segments) => groupsOf(segments, file));
};
