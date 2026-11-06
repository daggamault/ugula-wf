import type { ClaimCheck } from './claim-validation.ts';
import type { Documentation } from './documentation.ts';
import type { Submitter, X837Claim } from './x837.ts';

const PLACE = { addressLine: '9 Oak Ave', city: 'Springfield', state: 'IL', postalCode: '62702' };

const checkedPayer = (name: string, payerId: string | null = `p-${name}`) => ({
  coverageId: `cov-${name}`,
  name,
  payerId,
  claimFiling: payerId ? 'MB' : null,
  memberId: `M-${name}`,
  relationship: '18',
  insuredFirstName: null,
  insuredLastName: null,
  filingLimitDays: null,
  eligibility: null,
  eligibilityNote: null,
  stay: null
});

export const COMPLETE_DOCUMENTATION: Documentation = {
  signature: 'signed',
  signatureNote: null,
  pcsOnFile: null,
  pcsSignedOn: null,
  transportReason: 'A',
  conditionCodes: [],
  priorAuthorization: null,
  weightKg: null,
  atScene: '2025-12-30T10:05:00Z',
  leftScene: '2025-12-30T10:25:00Z',
  atDestination: '2025-12-30T10:40:00Z',
  patientCount: null,
  closestFacilityMiles: null,
  abnOnFile: null,
  abnSignedOn: null,
  denialExpected: null,
  mspEmployerPlan: null,
  mspEsrd: null,
  mspDisability: null,
  mspAccident: null,
  priorAuthorizationExpiresOn: null,
  pcsType: null,
  roundTrips: null,
  admissionDate: null,
  facilityStay: null
};

export const completeCheck = (payers = ['Medicare', 'Blue']): ClaimCheck => ({
  patientId: 'p1',
  patient: PLACE,
  pcrNumber: 'PCR-1',
  classification: 'emergency',
  level: 'ALS1',
  emergency: true,
  loadedMiles: 7.3,
  deceased: false,
  nonCoveredMiles: null,
  pickupFacility: null,
  destinationFacility: null,
  responsibleParty: 'payer',
  responsibilityRecorded: false,
  documents: [],
  timeZone: 'America/Chicago',
  lines: [
    { code: 'A0427', units: 1, unitCents: 92_700, totalCents: 92_700 },
    { code: 'A0425', units: 7.3, unitCents: 1_000, totalCents: 7_300 }
  ],
  totalCents: 100_000,
  payers: payers.map((p) => checkedPayer(p)),
  details: {
    serviceDate: '2025-12-30',
    pickup: { name: null, ...PLACE },
    destination: { name: 'Mercy', ...PLACE },
    diagnoses: ['R079'],
    originDestination: 'RH',
    documentation: COMPLETE_DOCUMENTATION
  }
});

export const sampleSubmitter: Submitter = {
  organizationName: 'Metro EMS',
  npi: '1234567893',
  taxId: '123456789',
  addressLine: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  postalCode: '627011234',
  phone: '2175550100',
  submitterId: 'SUB01',
  receiverId: 'RCV01',
  receiverName: 'Demo Clearinghouse',
  production: false
};

export const sampleLine = {
  code: 'A0427',
  modifiers: ['RH'],
  chargeCents: 85_000,
  units: 1,
  serviceDate: '2026-10-01'
};

export const sampleX837: X837Claim = {
  claimId: 'c-1',
  placeOfService: '41',
  frequency: '1',
  admissionDate: null,
  payerClaimNumber: null,
  priorAuthorization: null,
  note: null,
  subscriber: {
    relationship: '18',
    lastName: "O'Brien~*",
    firstName: 'José',
    memberId: '1EG4TE5MK73',
    groupId: null
  },
  patient: {
    lastName: "O'Brien~*",
    firstName: 'José',
    birthDate: '1950-02-03',
    sex: 'M',
    ...PLACE
  },
  payer: { name: 'Medicare', payerId: 'DEMOMCR', claimFiling: 'MB', insuranceType: null },
  otherPayers: [],
  weightPounds: null,
  transportReason: 'A',
  loadedMiles: 7.33,
  conditionCodes: ['09', '06'],
  diagnoses: ['R079', 'I10'],
  pickup: { name: null, ...PLACE },
  dropoff: { name: 'Mercy Hospital', ...PLACE, addressLine: '100 Health Way' },
  lines: [
    sampleLine,
    { code: 'A0425', modifiers: ['RH'], chargeCents: 9_250, units: 7.4, serviceDate: '2026-10-01' }
  ]
};

export const sampleEnvelope = { controlNumber: 42, createdAt: new Date('2026-10-23T14:05:09Z') };

export const sampleRejectedX837: X837Claim = {
  ...sampleX837,
  claimId: 'c-2',
  subscriber: { ...sampleX837.subscriber, memberId: 'REJECT123' }
};

export const sampleDependentX837: X837Claim = {
  ...sampleX837,
  claimId: 'c-3',
  subscriber: {
    relationship: '01',
    lastName: 'Smith',
    firstName: 'Ann',
    memberId: 'SPOUSE1',
    groupId: null
  },
  payer: { name: 'Aetna', payerId: 'AETNA', claimFiling: 'CI', insuranceType: null },
  otherPayers: [
    {
      name: 'Medicare',
      payerId: 'DEMOMCR',
      claimFiling: 'MB',
      memberId: 'OTHER-MEMBER',
      groupId: null,
      relationship: '18',
      lastName: 'Smith',
      firstName: 'Bob',
      paidCents: 10_000,
      adjustedCents: 0,
      adjustments: [],
      paidOn: '2026-10-10'
    }
  ],
  lines: [{ ...sampleX837.lines[0], serviceDate: '2026-10-02' } as X837Claim['lines'][number]]
};
