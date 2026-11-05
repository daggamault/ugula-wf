import { dateOf, readX12, textOf, transactionsOf } from './x12.ts';

export type FacilityStayHint = {
  kind: 'inpatient' | 'snf';
  admittedOn: string | null;
  dischargedOn: string | null;
};

export type EligibilityResult = {
  trace: string;
  active: boolean | null;
  planName: string | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  advantagePlan: string | null;
  stay: FacilityStayHint | null;
  messages: string[];
};

const ACTIVE = ['1', '2', '3', '4', '5'];

const INACTIVE = ['6', '7', '8'];

const MEMBER_LEVELS = ['22', '23'];

const OTHER_PAYER = 'R';

const MANAGED_CARE_PLANS = ['HM', 'HN', 'PR', 'PS'];

const PLAN_ENTITIES = ['PRP', 'PR', 'P3'];

const UNNAMED_PLAN = 'A Medicare Advantage plan';

const STAY_SERVICES: Readonly<Record<string, FacilityStayHint['kind']>> = {
  '48': 'inpatient',
  AG: 'snf'
};

const stayKindOf = (eb: string[]) =>
  (eb[3] ?? '')
    .split('^')
    .map((code) => STAY_SERVICES[code.trim()])
    .find((kind) => kind !== undefined) ?? null;

const REJECTS: Readonly<Record<string, string>> = {
  '15': 'Required application data missing',
  '41': 'Authorization or access restrictions',
  '42': 'The payer is unable to respond now',
  '43': 'Invalid or missing provider identification',
  '58': 'Invalid or missing date of birth',
  '72': 'Invalid or missing member ID',
  '73': 'Invalid or missing subscriber name',
  '75': 'Subscriber not found',
  '76': 'Duplicate member ID',
  '79': 'Invalid participant identification'
};

type Draft = EligibilityResult & { traced: boolean; otherPlan: boolean; staying: boolean };

const rejectOf = (aaa: string[]) => {
  const code = aaa[3]?.trim() ?? '';
  return REJECTS[code] ?? `Rejected with reason ${code || 'not given'}`;
};

const rangeOf = (dtp: string[]) => {
  const [from, to] = (dtp[3] ?? '').split('-');
  return dtp[2] === 'RD8' ? [dateOf(from), dateOf(to)] : [dateOf(dtp[3]), null];
};

const resultsOf = (segments: string[][]) => {
  const results: EligibilityResult[] = [];
  const shared: string[] = [];
  let draft: Draft | null = null;
  const close = () => {
    if (draft?.traced) {
      const { traced: _, otherPlan: __, staying: ___, ...result } = draft;
      results.push({
        ...result,
        stay: result.stay?.admittedOn ? result.stay : null,
        messages: [...shared, ...result.messages]
      });
    }
  };
  for (const seg of segments) {
    switch (seg[0]) {
      case 'HL':
        close();
        draft = MEMBER_LEVELS.includes(seg[3] ?? '')
          ? {
              trace: '',
              traced: false,
              active: null,
              planName: null,
              coverageStart: null,
              coverageEnd: null,
              advantagePlan: null,
              stay: null,
              otherPlan: false,
              staying: false,
              messages: []
            }
          : null;
        break;
      case 'TRN':
        if (draft && seg[1] === '2' && !draft.traced) {
          draft.trace = seg[2]?.trim() ?? '';
          draft.traced = true;
        }
        break;
      case 'EB': {
        if (!draft) break;
        const code = seg[1] ?? '';
        draft.otherPlan = code === OTHER_PAYER && MANAGED_CARE_PLANS.includes(seg[4] ?? '');
        if (draft.otherPlan) draft.advantagePlan ??= textOf(seg[5]) ?? UNNAMED_PLAN;
        const stay = stayKindOf(seg);
        draft.staying = stay !== null && (draft.stay === null || draft.stay.kind === stay);
        if (stay && !draft.stay) draft.stay = { kind: stay, admittedOn: null, dischargedOn: null };
        if (draft.active === null && (ACTIVE.includes(code) || INACTIVE.includes(code))) {
          draft.active = ACTIVE.includes(code);
          draft.planName ??= textOf(seg[5]);
        }
        break;
      }
      case 'NM1':
        if (draft?.otherPlan && PLAN_ENTITIES.includes(seg[1] ?? '')) {
          draft.advantagePlan = textOf(seg[3]) ?? draft.advantagePlan;
        }
        break;
      case 'DTP': {
        if (!draft || draft.otherPlan) break;
        const [from, to] = rangeOf(seg);
        if (draft.staying && draft.stay) {
          if (seg[1] === '435' || seg[1] === '472') draft.stay.admittedOn ??= from ?? null;
          if (seg[1] === '096') draft.stay.dischargedOn ??= from ?? null;
          if (seg[1] === '472') draft.stay.dischargedOn ??= to ?? null;
          break;
        }
        if (seg[1] === '346') draft.coverageStart ??= from ?? null;
        if (seg[1] === '347') draft.coverageEnd ??= from ?? null;
        if (seg[1] === '291' && seg[2] === 'RD8') {
          draft.coverageStart ??= from ?? null;
          draft.coverageEnd ??= to ?? null;
        }
        break;
      }
      case 'AAA':
        (draft ? draft.messages : shared).push(rejectOf(seg));
        break;
      case 'MSG': {
        const text = textOf(seg[1]);
        if (text) (draft ? draft.messages : shared).push(text);
        break;
      }
    }
  }
  close();
  return results;
};

export const read271 = (text: string): EligibilityResult[] =>
  transactionsOf(readX12(text), '271').flatMap(resultsOf);
