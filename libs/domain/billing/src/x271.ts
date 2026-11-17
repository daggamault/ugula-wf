import { dateOf, readX12, textOf, transactionsOf, type X12File } from './x12.ts';

export type FacilityStayHint = {
  kind: 'inpatient' | 'snf';
  admittedOn: string | null;
  dischargedOn: string | null;
};

type PayerName = { name: string | null; payerId: string | null };

export type OtherPayer = PayerName & {
  entity: string;
  memberId: string | null;
  groupId: string | null;
};

export type EligibilityResult = {
  trace: string;
  payer: PayerName;
  memberId: string | null;
  groupId: string | null;
  otherPayers: OtherPayer[];
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

const PAYER_ENTITIES = ['PRP', 'SEP', 'TTP', 'PR'];

const MEMBER_REFS = ['1W', 'IG'];

const GROUP_REFS = ['6P', '18'];

const UNNAMED_PLAN = 'A Medicare Advantage plan';

const STAY_SERVICES: Readonly<Record<string, FacilityStayHint['kind']>> = {
  '48': 'inpatient',
  AG: 'snf'
};

const stayKindOf = (eb: string[], repetition: string | null) =>
  (repetition ? (eb[3] ?? '').split(repetition) : [eb[3] ?? ''])
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

type Draft = EligibilityResult & {
  otherPlan: boolean;
  staying: boolean;
  benefits: boolean;
  other: OtherPayer | null;
  refs: Map<string, string>;
};

const groupOf = (refs: ReadonlyMap<string, string>) =>
  GROUP_REFS.map((q) => refs.get(q)).find(Boolean) ?? null;

const rejectOf = (aaa: string[]) => {
  const code = aaa[3]?.trim() ?? '';
  return REJECTS[code] ?? `Rejected with reason ${code || 'not given'}`;
};

const rangeOf = (dtp: string[]) => {
  const [from, to] = (dtp[3] ?? '').split('-');
  return dtp[2] === 'RD8' ? [dateOf(from), dateOf(to)] : [dateOf(dtp[3]), null];
};

const resultsOf = (segments: string[][], file: X12File) => {
  const results: EligibilityResult[] = [];
  const shared: string[] = [];
  let payer: PayerName = { name: null, payerId: null };
  let draft: Draft | null = null;
  const close = () => {
    if (draft?.trace) {
      const { otherPlan: _, staying: __, benefits: ___, other: ____, refs, ...result } = draft;
      results.push({
        ...result,
        groupId: groupOf(refs),
        stay: result.stay?.admittedOn ? result.stay : null,
        messages: [...shared, ...result.messages]
      });
    }
  };
  for (const seg of segments) {
    switch (seg[0]) {
      case 'HL':
        close();
        if (seg[3] === '20') {
          shared.length = 0;
          payer = { name: null, payerId: null };
        }
        draft = MEMBER_LEVELS.includes(seg[3] ?? '')
          ? {
              trace: '',
              payer,
              memberId: null,
              groupId: null,
              otherPayers: [],
              active: null,
              planName: null,
              coverageStart: null,
              coverageEnd: null,
              advantagePlan: null,
              stay: null,
              otherPlan: false,
              staying: false,
              benefits: false,
              other: null,
              refs: new Map(),
              messages: []
            }
          : null;
        break;
      case 'TRN':
        if (draft && seg[1] === '2' && !draft.trace) draft.trace = textOf(seg[2]) ?? '';
        break;
      case 'EB': {
        if (!draft) break;
        const code = seg[1] ?? '';
        draft.benefits = true;
        draft.other =
          code === OTHER_PAYER
            ? { entity: '', name: null, payerId: null, memberId: null, groupId: null }
            : null;
        if (draft.other) draft.otherPayers.push(draft.other);
        draft.otherPlan = code === OTHER_PAYER && MANAGED_CARE_PLANS.includes(seg[4] ?? '');
        if (draft.otherPlan) draft.advantagePlan ??= textOf(seg[5]) ?? UNNAMED_PLAN;
        const stay = stayKindOf(seg, file.repetition);
        draft.staying = stay !== null && (draft.stay === null || draft.stay.kind === stay);
        if (stay && !draft.stay) draft.stay = { kind: stay, admittedOn: null, dischargedOn: null };
        if (draft.active === null && (ACTIVE.includes(code) || INACTIVE.includes(code))) {
          draft.active = ACTIVE.includes(code);
          draft.planName ??= textOf(seg[5]);
        }
        break;
      }
      case 'NM1': {
        const entity = seg[1] ?? '';
        if (!draft) {
          if (entity === 'PR') payer = { name: textOf(seg[3]), payerId: textOf(seg[9]) };
          break;
        }
        if (!draft.benefits && entity === 'IL') draft.memberId = textOf(seg[9]);
        if (draft.other && PAYER_ENTITIES.includes(entity) && !draft.other.entity) {
          Object.assign(draft.other, { entity, name: textOf(seg[3]), payerId: textOf(seg[9]) });
        }
        if (draft.otherPlan && PLAN_ENTITIES.includes(entity)) {
          draft.advantagePlan = textOf(seg[3]) ?? draft.advantagePlan;
        }
        break;
      }
      case 'REF': {
        const [, q = '', value] = seg;
        const ref = textOf(value);
        if (!draft || !ref) break;
        if (!draft.benefits) {
          if (!draft.refs.has(q)) draft.refs.set(q, ref);
          break;
        }
        if (!draft.other) break;
        if (MEMBER_REFS.includes(q)) draft.other.memberId ??= ref;
        if (GROUP_REFS.includes(q) && (q === GROUP_REFS[0] || !draft.other.groupId)) {
          draft.other.groupId = ref;
        }
        break;
      }
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

export const read271 = (text: string): EligibilityResult[] => {
  const file = readX12(text);
  return transactionsOf(file, '271').flatMap((segments) => resultsOf(segments, file));
};

export type DiscoveredCoverage = {
  payerName: string | null;
  payerCode: string;
  memberId: string;
  groupId: string | null;
  planName: string | null;
  entity: string;
};

const ANSWERING_PAYER = 'PR';

export const discovered = (results: EligibilityResult[]): DiscoveredCoverage[] =>
  results.flatMap((r) => [
    ...(r.active && r.memberId && r.payer.payerId
      ? [
          {
            payerName: r.payer.name,
            payerCode: r.payer.payerId,
            memberId: r.memberId,
            groupId: r.groupId,
            planName: r.planName,
            entity: ANSWERING_PAYER
          }
        ]
      : []),
    ...r.otherPayers.flatMap((o) =>
      o.payerId && o.memberId
        ? [
            {
              payerName: o.name,
              payerCode: o.payerId,
              memberId: o.memberId,
              groupId: o.groupId,
              planName: null,
              entity: o.entity
            }
          ]
        : []
    )
  ]);
