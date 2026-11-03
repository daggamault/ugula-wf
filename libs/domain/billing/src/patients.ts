import { usState, zipCode } from './geo.ts';
import { firstNameLikeness, jaroWinkler, NICKNAME_LIKENESS, nameKey } from './names.ts';
import { recordOf, textOrNull } from './values.ts';

export const SEXES = ['F', 'M', 'U'] as const;

export type Sex = (typeof SEXES)[number];

export type Address = {
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

export type Demographics = Address & {
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  gender: Sex | null;
};

export type NewPatient = Address & {
  firstName: string;
  lastName: string;
  birthDate: string;
  gender: Sex | null;
};

export type Patient = NewPatient & { id: string };

type MatchDecision =
  | { kind: 'matched'; patient: Patient }
  | { kind: 'unmatched' }
  | { kind: 'review'; reason: string; candidates: Patient[] }
  | { kind: 'incomplete' };

const SEX_CODES = new Map<string, Sex>([
  ['F', 'F'],
  ['M', 'M'],
  ['U', 'U'],
  ['9919001', 'F'],
  ['9919003', 'M'],
  ['9919005', 'U'],
  ['9906001', 'F'],
  ['9906003', 'M'],
  ['9906005', 'U']
]);

export const sexOf = (x: unknown): Sex | null => {
  const code = textOrNull(x)?.toUpperCase();
  return code ? (SEX_CODES.get(code) ?? null) : null;
};

const cityName = (x: unknown) => {
  const name = textOrNull(x);
  return name && !/^\d+$/.test(name) ? name : null;
};

export const readAddress = (r: Record<string, unknown>): Address => ({
  addressLine: textOrNull(r.addressLine),
  city: cityName(r.city),
  state: usState(r.state),
  postalCode: zipCode(r.postalCode)
});

export const isCompleteAddress = (a: Address) =>
  Boolean(a.addressLine && a.city && a.state && a.postalCode);

const addressKey = (a: Address) =>
  [a.addressLine, a.city, a.state, a.postalCode?.slice(0, 5)]
    .map((x) => (x ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''))
    .join('|');

export const sameAddress = (a: Address, b: Address) => addressKey(a) === addressKey(b);

const isCalendarDate = (s: string) => {
  const t = Date.parse(`${s}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(t) && new Date(t).toISOString().startsWith(s)
  );
};

export const readDemographics = (x: unknown): Demographics => {
  const r = recordOf(x);
  const birthDate = textOrNull(r.birthDate);
  return {
    firstName: textOrNull(r.firstName),
    lastName: textOrNull(r.lastName),
    birthDate: birthDate && isCalendarDate(birthDate) ? birthDate : null,
    gender: sexOf(r.gender),
    ...readAddress(r)
  };
};

export const toNewPatient = (d: Demographics): NewPatient | null =>
  d.firstName && d.lastName && nameKey(d.lastName) && d.birthDate
    ? {
        firstName: d.firstName,
        lastName: d.lastName,
        birthDate: d.birthDate,
        gender: d.gender,
        addressLine: d.addressLine,
        city: d.city,
        state: d.state,
        postalCode: d.postalCode
      }
    : null;

type BirthLikeness = 'same' | 'typo' | 'different' | 'unknown';

const isTransposition = (a: string, b: string) => {
  const i = [...a].findIndex((c, k) => c !== b[k]);
  return i >= 0 && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
};

const birthLikeness = (reported: string | null, known: string): BirthLikeness => {
  if (!reported) return 'unknown';
  if (reported === known) return 'same';
  const [y, m, d] = reported.split('-');
  const differing = [...reported].filter((c, i) => c !== known[i]).length;
  return `${y}-${d}-${m}` === known || differing === 1 || isTransposition(reported, known)
    ? 'typo'
    : 'different';
};

type Likeness = { birth: BirthLikeness; last: number; first: number; sexConflict: boolean };

const BIRTH_WEIGHT: Record<BirthLikeness, number> = { same: 2, typo: 1, unknown: 0, different: 0 };

const SIMILAR_NAME = 0.85;

const CLOSE_NAME = 0.9;

const isKnownSex = (s: Sex | null) => s === 'F' || s === 'M';

const likeness = (d: Demographics, p: Patient): Likeness => ({
  birth: birthLikeness(d.birthDate, p.birthDate),
  last: jaroWinkler(nameKey(d.lastName ?? ''), nameKey(p.lastName)),
  first: firstNameLikeness(nameKey(d.firstName ?? ''), nameKey(p.firstName)),
  sexConflict: isKnownSex(d.gender) && isKnownSex(p.gender) && d.gender !== p.gender
});

const isSame = (l: Likeness) =>
  l.birth === 'same' && l.last === 1 && l.first >= NICKNAME_LIKENESS && !l.sexConflict;

const isSimilar = ({ birth, last, first }: Likeness) =>
  birth === 'same'
    ? last >= SIMILAR_NAME || first >= SIMILAR_NAME
    : birth !== 'different' && last >= CLOSE_NAME && first >= SIMILAR_NAME;

const score = (l: Likeness) => BIRTH_WEIGHT[l.birth] + l.last + l.first;

export const isSamePerson = (d: Demographics, p: Patient) => isSame(likeness(d, p));

export const matchPatient = (d: Demographics, candidates: Patient[]): MatchDecision => {
  const exact = candidates.filter((p) => isSamePerson(d, p));
  const [only] = exact;
  if (only && exact.length === 1) return { kind: 'matched', patient: only };
  if (exact.length) {
    return {
      kind: 'review',
      reason: 'Several patients share this name and birth date',
      candidates: exact
    };
  }
  const similar = candidates
    .map((p) => ({ p, l: likeness(d, p) }))
    .filter(({ l }) => isSimilar(l))
    .sort((a, b) => score(b.l) - score(a.l))
    .map(({ p }) => p);
  if (!toNewPatient(d)) return { kind: 'incomplete' };
  return similar.length
    ? { kind: 'review', reason: 'Similar patients found', candidates: similar }
    : { kind: 'unmatched' };
};
