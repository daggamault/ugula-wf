import {
  isServiceLevel,
  isTripType,
  MAX_LOADED_MILES,
  type PricedLine,
  type ServiceLevel,
  type TripType
} from './charges.ts';
import {
  type InsuredRelationship,
  isOriginDestination,
  isRelationship,
  type Location,
  readClaimDetails,
  SELF
} from './claim-details.ts';
import { ADDRESS_FIELDS } from './claim-fix-fields.ts';
import type { ClaimCheck } from './claim-validation.ts';
import {
  type FacilityStay,
  facilityStayOf,
  isSignatureStatus,
  isTransportReason,
  MAX_DOCUMENTED_COUNT,
  type MspAccident,
  mspAccidentOf,
  type PcsType,
  pcsTypeOf,
  type SignatureStatus,
  type TransportReason
} from './documentation.ts';
import { type Address, readAddress } from './patients.ts';
import { recordOf, textOrNull } from './values.ts';

export type CoveragePatch = {
  coverageId: string;
  payerId: string | null;
  memberId: string | null;
  relationship: InsuredRelationship | null;
  insuredFirstName: string | null;
  insuredLastName: string | null;
  remove: boolean;
};

type NewCoverage = {
  payerId: string;
  memberId: string | null;
  relationship: InsuredRelationship;
  insuredFirstName: string | null;
  insuredLastName: string | null;
};

type DocumentationValues = {
  signature: SignatureStatus;
  pcsOnFile: boolean | null;
  pcsSignedOn: string | null;
  transportReason: TransportReason | null;
  patientCount: number | null;
  abnOnFile: boolean | null;
  abnSignedOn: string | null;
  denialExpected: boolean | null;
  mspEmployerPlan: boolean | null;
  mspEsrd: boolean | null;
  mspDisability: boolean | null;
  mspAccident: MspAccident | null;
  priorAuthorization: string | null;
  priorAuthorizationExpiresOn: string | null;
  pcsType: PcsType | null;
  roundTrips: number | null;
  admissionDate: string | null;
  facilityStay: FacilityStay | null;
};

export type DocumentationPatch = {
  [K in keyof DocumentationValues]?: DocumentationValues[K] | undefined;
};

export type ClaimPatch = {
  serviceDate: string | null;
  tripType: TripType | null;
  level: ServiceLevel | null;
  emergency: boolean | null;
  loadedMiles: number | null;
  deceased: boolean | null;
  nonCoveredMiles: number | null;
  diagnoses: string[] | null;
  pickup: Location | null;
  destination: Location | null;
  originDestination: string | null;
  documentation: DocumentationPatch | null;
  patientAddress: Address | null;
  coverage: CoveragePatch | null;
  newCoverage: NewCoverage | null;
  lines: PricedLine[] | null;
  note: string | null;
};

const changedAddress = (r: Record<string, unknown>, prefix: string, current: Address) => {
  const given = ADDRESS_FIELDS.some(([part]) => textOrNull(r[`${prefix}${part}`]) !== null);
  if (!given) return null;
  const pick = (part: string, now: string | null) => textOrNull(r[`${prefix}${part}`]) ?? now;
  return readAddress({
    addressLine: pick('AddressLine', current.addressLine),
    city: pick('City', current.city),
    state: pick('State', current.state),
    postalCode: pick('PostalCode', current.postalCode)
  });
};

const coveragePatch = (r: Record<string, unknown>, check: ClaimCheck): CoveragePatch | null => {
  const coverageId = textOrNull(r.coverageId);
  if (!coverageId || !check.payers.some((p) => p.coverageId === coverageId)) return null;
  const patch = {
    coverageId,
    payerId: textOrNull(r.payerId),
    memberId: textOrNull(r.memberId),
    relationship: isRelationship(r.relationship) ? r.relationship : null,
    insuredFirstName: textOrNull(r.insuredFirstName),
    insuredLastName: textOrNull(r.insuredLastName),
    remove: r.removeCoverage === true
  };
  const { coverageId: _, remove, ...values } = patch;
  return remove || Object.values(values).some((v) => v !== null) ? patch : null;
};

const newCoverage = (r: Record<string, unknown>, check: ClaimCheck): NewCoverage | null => {
  const payerId = textOrNull(r.payerId);
  return payerId && !textOrNull(r.coverageId) && !check.payers.length
    ? {
        payerId,
        memberId: textOrNull(r.memberId),
        relationship: isRelationship(r.relationship) ? r.relationship : SELF,
        insuredFirstName: textOrNull(r.insuredFirstName),
        insuredLastName: textOrNull(r.insuredLastName)
      }
    : null;
};

const modifier = (r: Record<string, unknown>, current: string | null) => {
  const code = `${textOrNull(r.originCode) ?? current?.[0] ?? ''}${textOrNull(r.destinationCode) ?? current?.[1] ?? ''}`;
  return code !== current && isOriginDestination(code) ? code : null;
};

const dateIn = (x: unknown) => readClaimDetails({ serviceDate: x }).serviceDate;

const flagIn = (x: unknown) => (typeof x === 'boolean' ? x : null);

const countIn = (x: unknown, min: number) =>
  typeof x === 'number' && Number.isInteger(x) && x >= min && x <= MAX_DOCUMENTED_COUNT ? x : null;

const milesIn = (x: unknown) =>
  typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= MAX_LOADED_MILES ? x : null;

const documentationPatch = (
  r: Record<string, unknown>,
  check: ClaimCheck
): DocumentationPatch | null => {
  const now = check.details.documentation;
  const reason = textOrNull(r.transportReason)?.toUpperCase();
  const given = {
    signature: isSignatureStatus(r.signature) ? r.signature : null,
    pcsOnFile: flagIn(r.pcsOnFile),
    pcsSignedOn: dateIn(r.pcsSignedOn),
    transportReason: isTransportReason(reason) ? reason : null,
    patientCount: countIn(r.patientCount, 1),
    abnOnFile: flagIn(r.abnOnFile),
    abnSignedOn: dateIn(r.abnSignedOn),
    denialExpected: flagIn(r.denialExpected),
    mspEmployerPlan: flagIn(r.mspEmployerPlan),
    mspEsrd: flagIn(r.mspEsrd),
    mspDisability: flagIn(r.mspDisability),
    mspAccident: mspAccidentOf(r.mspAccident),
    priorAuthorization: textOrNull(r.priorAuthorization),
    priorAuthorizationExpiresOn: dateIn(r.priorAuthorizationExpiresOn),
    pcsType: pcsTypeOf(r.pcsType),
    roundTrips: countIn(r.roundTrips, 0),
    admissionDate: dateIn(r.admissionDate),
    facilityStay: facilityStayOf(r.facilityStay)
  };
  const patch: DocumentationPatch = Object.fromEntries(
    Object.entries(given).filter(([k, v]) => v !== null && v !== now[k as keyof typeof now])
  );
  return Object.keys(patch).length ? patch : null;
};

export const readClaimPatch = (values: unknown, check: ClaimCheck): ClaimPatch => {
  const r = recordOf(values);
  const details = readClaimDetails({ serviceDate: r.serviceDate, diagnoses: r.diagnoses });
  const pickup = changedAddress(r, 'pickup', check.details.pickup);
  const destination = changedAddress(r, 'destination', check.details.destination);
  const destinationName = textOrNull(r.destinationName);
  const miles = milesIn(r.loadedMiles);
  const nonCovered = milesIn(r.nonCoveredMiles);
  return {
    serviceDate: details.serviceDate,
    tripType: isTripType(r.tripType) && r.tripType !== 'noClaim' ? r.tripType : null,
    level: isServiceLevel(r.level) ? r.level : null,
    emergency: typeof r.emergency === 'boolean' ? r.emergency : null,
    loadedMiles: miles,
    deceased: typeof r.deceased === 'boolean' && r.deceased !== check.deceased ? r.deceased : null,
    nonCoveredMiles:
      nonCovered !== null && nonCovered !== (check.nonCoveredMiles ?? 0) ? nonCovered : null,
    diagnoses: Array.isArray(r.diagnoses) && details.diagnoses.length ? details.diagnoses : null,
    pickup: pickup && { name: check.details.pickup.name, ...pickup },
    destination:
      destination || destinationName
        ? {
            name: destinationName ?? check.details.destination.name,
            ...(destination ?? check.details.destination)
          }
        : null,
    originDestination: modifier(r, check.details.originDestination),
    documentation: documentationPatch(r, check),
    patientAddress: check.patient ? changedAddress(r, 'patient', check.patient) : null,
    coverage: coveragePatch(r, check),
    newCoverage: newCoverage(r, check),
    lines: null,
    note: textOrNull(r.note)
  };
};

export const chargeChanges = (p: ClaimPatch) => ({
  tripType: p.tripType !== null,
  level: p.level !== null,
  emergency: p.emergency !== null,
  loadedMiles: p.loadedMiles !== null,
  deceased: p.deceased !== null,
  nonCoveredMiles: p.nonCoveredMiles !== null,
  payers: p.coverage !== null || p.newCoverage !== null
});
