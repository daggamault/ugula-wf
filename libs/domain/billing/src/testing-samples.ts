import type { Submitter, X837Claim } from './x837.ts';

const PLACE = { addressLine: '9 Oak Ave', city: 'Springfield', state: 'IL', postalCode: '62702' };

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
  serviceDate: '2026-10-01',
  patientCount: null
};

export const sampleX837: X837Claim = {
  claimId: 'c-1',
  placeOfService: '41',
  frequency: '1',
  benefitsAssignment: 'Y',
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
  loadedMiles: 7.4,
  conditionCodes: ['09', '06'],
  diagnoses: ['R079', 'I10'],
  pickup: { name: null, ...PLACE },
  dropoff: { name: 'Mercy Hospital', ...PLACE, addressLine: '100 Health Way' },
  lines: [
    sampleLine,
    {
      code: 'A0425',
      modifiers: ['RH'],
      chargeCents: 9_250,
      units: 7.4,
      serviceDate: '2026-10-01',
      patientCount: null
    }
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
      lines: [],
      paidOn: '2026-10-10'
    }
  ],
  lines: [{ ...sampleX837.lines[0], serviceDate: '2026-10-02' } as X837Claim['lines'][number]]
};
