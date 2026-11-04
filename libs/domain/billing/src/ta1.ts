import { readX12 } from './x12.ts';

export type InterchangeAcknowledgment = {
  controlNumber: string;
  status: 'accepted' | 'acceptedWithErrors' | 'rejected';
  noteCode: string;
  message: string;
};

const NOTES: Readonly<Record<string, string>> = {
  '000': 'No error',
  '001': 'The interchange control numbers in the header and trailer do not match',
  '002': 'This standard as noted in the control standards identifier is not supported',
  '003': 'This version of the controls is not supported',
  '004': 'The segment terminator is invalid',
  '005': 'Invalid interchange ID qualifier for the sender',
  '006': 'Invalid interchange sender ID',
  '007': 'Invalid interchange ID qualifier for the receiver',
  '008': 'Invalid interchange receiver ID',
  '009': 'Unknown interchange receiver ID',
  '010': 'Invalid authorization information qualifier',
  '011': 'Invalid authorization information value',
  '012': 'Invalid security information qualifier',
  '013': 'Invalid security information value',
  '014': 'Invalid interchange date',
  '015': 'Invalid interchange time',
  '016': 'Invalid interchange standards identifier',
  '017': 'Invalid interchange version ID',
  '018': 'Invalid interchange control number',
  '019': 'Invalid acknowledgment requested value',
  '020': 'Invalid test indicator value',
  '021': 'Invalid number of included groups value',
  '022': 'Invalid control structure',
  '023': 'Improper (premature) end-of-file',
  '024': 'Invalid interchange content',
  '025': 'Duplicate interchange control number',
  '026': 'Invalid data element separator',
  '027': 'Invalid component element separator',
  '028': 'Invalid delivery date in deferred delivery request',
  '029': 'Invalid delivery time in deferred delivery request',
  '030': 'Invalid delivery time code in deferred delivery request',
  '031': 'Invalid grade of service code'
};

const STATUSES: Readonly<Record<string, InterchangeAcknowledgment['status']>> = {
  A: 'accepted',
  E: 'acceptedWithErrors',
  R: 'rejected'
};

export const readTA1 = (text: string): InterchangeAcknowledgment[] =>
  readX12(text).segments.flatMap((seg) => {
    if (seg[0] !== 'TA1') return [];
    const noteCode = seg[5]?.trim() ?? '';
    return [
      {
        controlNumber: seg[1]?.trim() ?? '',
        status: STATUSES[seg[4]?.trim() ?? ''] ?? 'rejected',
        noteCode,
        message: NOTES[noteCode] ?? `Interchange note ${noteCode || 'not given'}`
      }
    ];
  });
