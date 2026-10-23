import { usState, zipCode } from './geo.ts';

export type Sex = 'F' | 'M' | 'U';

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

export type MatchDecision =
  | { kind: 'matched'; patient: Patient }
  | { kind: 'unmatched' }
  | { kind: 'review'; reason: string; candidates: Patient[] };

const text = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);

const SEX_CODES: Record<string, Sex> = {
  F: 'F',
  M: 'M',
  U: 'U',
  '9919001': 'F',
  '9919003': 'M',
  '9919005': 'U',
  '9906001': 'F',
  '9906003': 'M',
  '9906005': 'U'
};

export const sexOf = (x: unknown): Sex | null => {
  const code = text(x)?.toUpperCase();
  return code && Object.hasOwn(SEX_CODES, code) ? (SEX_CODES[code] ?? null) : null;
};

const cityName = (x: unknown) => {
  const name = text(x);
  return name && !/^\d+$/.test(name) ? name : null;
};

export const readAddress = (r: Record<string, unknown>): Address => ({
  addressLine: text(r.addressLine),
  city: cityName(r.city),
  state: usState(r.state),
  postalCode: zipCode(r.postalCode)
});

const isCalendarDate = (s: string) => {
  const t = Date.parse(`${s}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(t) && new Date(t).toISOString().startsWith(s)
  );
};

export const nameKey = (name: string) =>
  name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}]/gu, '');

export const readDemographics = (x: unknown): Demographics => {
  const r =
    x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
  const birthDate = text(r.birthDate);
  return {
    firstName: text(r.firstName),
    lastName: text(r.lastName),
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

const initialOf = (name: string | null) => (name ? nameKey(name).charAt(0) : '');

export const isSamePerson = (d: Demographics, p: Patient) =>
  !!d.lastName &&
  !!d.birthDate &&
  initialOf(d.firstName) !== '' &&
  nameKey(p.lastName) === nameKey(d.lastName) &&
  p.birthDate === d.birthDate &&
  initialOf(p.firstName) === initialOf(d.firstName);

export const matchPatient = (d: Demographics, candidates: Patient[]): MatchDecision => {
  const last = d.lastName ? nameKey(d.lastName) : '';
  const first = d.firstName ? nameKey(d.firstName) : '';
  const sameLast = (p: Patient) => last !== '' && nameKey(p.lastName) === last;
  const sameFirst = (p: Patient) => first !== '' && nameKey(p.firstName) === first;
  const sameBirth = (p: Patient) => p.birthDate === d.birthDate;
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
  const similar = candidates.filter((p) =>
    sameBirth(p) ? sameLast(p) || sameFirst(p) : sameLast(p) && sameFirst(p)
  );
  if (!toNewPatient(d)) {
    return {
      kind: 'review',
      reason: 'The report is missing the first name, last name or birth date',
      candidates: similar
    };
  }
  return similar.length
    ? { kind: 'review', reason: 'Similar patients found', candidates: similar }
    : { kind: 'unmatched' };
};
