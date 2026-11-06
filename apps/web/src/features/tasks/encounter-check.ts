import { isRecord, type Json } from '@ugula/graph';
import { toPcr } from '@ugula/nemsis';
import type { TaskClaim } from './client.ts';

export type EncounterFacts = {
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  serviceDate: string | null;
  loadedMiles: number | null;
  memberIds: string[];
};

export type MismatchField = 'patient' | 'birthDate' | 'serviceDate' | 'loadedMiles' | 'memberId';

export type Mismatch = { field: MismatchField; label: string; encounter: string };

const sectionOf = (x: Json | undefined): Record<string, Json> => (isRecord(x) ? x : {});

const textOf = (x: Json | undefined) => (typeof x === 'string' && x.trim() ? x.trim() : null);

const numberOf = (x: Json | undefined) => (typeof x === 'number' ? x : null);

const dayOf = (at: string | null) => (at && /^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : null);

export const encounterFactsOf = (data: Json): EncounterFacts => {
  const pcr = toPcr(data);
  const patient = sectionOf(pcr.patient);
  const times = sectionOf(pcr.times);
  const response = sectionOf(pcr.response);
  const scene = numberOf(response.sceneOdometer);
  const destination = numberOf(response.destinationOdometer);
  return {
    firstName: textOf(patient.firstName),
    lastName: textOf(patient.lastName),
    birthDate: textOf(patient.birthDate),
    serviceDate:
      dayOf(textOf(times.psapCall)) ??
      dayOf(textOf(times.arrivedOnScene)) ??
      dayOf(textOf(times.leftScene)),
    loadedMiles:
      scene === null || destination === null ? null : Math.round((destination - scene) * 100) / 100,
    memberIds: (Array.isArray(pcr.insurances) ? pcr.insurances : [])
      .filter(isRecord)
      .flatMap((i) => textOf(i.policyId) ?? [])
  };
};

const normalized = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');

// Only facts the claim copies from the report: classification and level are decided by
// billing rules, so they may differ on purpose.
export const mismatchesOf = (claim: TaskClaim, e: EncounterFacts): Mismatch[] => {
  const out: Mismatch[] = [];
  const name = e.lastName ? [e.lastName, e.firstName].filter(Boolean).join(', ') : null;
  if (name && claim.patient && normalized(name) !== normalized(claim.patient)) {
    out.push({ field: 'patient', label: 'Patient', encounter: name });
  }
  if (e.birthDate && claim.birthDate && e.birthDate !== claim.birthDate) {
    out.push({ field: 'birthDate', label: 'Birth Date', encounter: e.birthDate });
  }
  if (e.serviceDate && claim.serviceDate && e.serviceDate !== claim.serviceDate) {
    out.push({ field: 'serviceDate', label: 'Date of Service', encounter: e.serviceDate });
  }
  const miles = claim.loadedMiles === null ? null : Number(claim.loadedMiles);
  if (e.loadedMiles !== null && miles !== null && Math.abs(miles - e.loadedMiles) >= 0.1) {
    out.push({ field: 'loadedMiles', label: 'Loaded Miles', encounter: String(e.loadedMiles) });
  }
  const known = new Set(e.memberIds.map(normalized));
  const unmatched = claim.payers.filter((p) => p.memberId && !known.has(normalized(p.memberId)));
  if (e.memberIds.length && unmatched.length) {
    out.push({ field: 'memberId', label: 'Member ID', encounter: e.memberIds.join(', ') });
  }
  return out;
};
