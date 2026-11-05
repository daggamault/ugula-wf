import {
  DEFAULT_PAYER,
  DEFAULT_PROVIDER,
  envelope,
  type MockOptions,
  type Party,
  stamp
} from './mock-envelope.ts';
import { clean } from './x12.ts';

type Mock271 = {
  trace: string;
  active: boolean;
  payer?: Party;
  provider?: Party;
  subscriber?: { lastName: string; firstName?: string | null; memberId: string };
  message?: string;
  advantagePlan?: Party;
  stay?: { kind: 'inpatient' | 'snf'; admittedOn: string };
};

const STAY_SERVICE = { inpatient: '48', snf: 'AG' } as const;

export const build271 = (e: Mock271, o: MockOptions = {}) => {
  const { date, time } = stamp(o);
  const payer = e.payer ?? DEFAULT_PAYER;
  const provider = e.provider ?? DEFAULT_PROVIDER;
  const subscriber = e.subscriber ?? {
    lastName: 'KLINE',
    firstName: 'DOROTHY',
    memberId: '2KT7XM4RW91'
  };
  return envelope(o, { functional: 'HB', version: '005010X279A1' }, [
    {
      id: '271',
      version: '005010X279A1',
      body: [
        ['BHT', '0022', '11', 'MOCK', date, time],
        ['HL', '1', '', '20', '1'],
        ['NM1', 'PR', '2', clean(payer.name), '', '', '', '', 'PI', payer.id],
        ['HL', '2', '1', '21', '1'],
        ['NM1', '1P', '2', clean(provider.name), '', '', '', '', 'XX', provider.id],
        ['HL', '3', '2', '22', '0'],
        ['TRN', '2', e.trace, '9123456789'],
        [
          'NM1',
          'IL',
          '1',
          clean(subscriber.lastName),
          clean(subscriber.firstName, 35),
          '',
          '',
          '',
          'MI',
          subscriber.memberId
        ],
        e.active ? ['EB', '1', '', '30', '', 'MEDICARE PART B'] : ['EB', '6', '', '30'],
        ...(e.message ? [['MSG', e.message]] : []),
        ...(e.stay
          ? [
              ['EB', 'X', '', STAY_SERVICE[e.stay.kind]],
              ['DTP', '435', 'D8', e.stay.admittedOn.replaceAll('-', '')]
            ]
          : []),
        ...(e.advantagePlan
          ? [
              ['EB', 'R', '', '30', 'HN'],
              ['LS', '2120'],
              [
                'NM1',
                'PRP',
                '2',
                clean(e.advantagePlan.name),
                '',
                '',
                '',
                '',
                'PI',
                e.advantagePlan.id
              ],
              ['LE', '2120']
            ]
          : [])
      ]
    }
  ]);
};
