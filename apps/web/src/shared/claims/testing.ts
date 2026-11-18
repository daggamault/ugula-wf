import type { ClaimDetail, EncounterLocation } from './claim-detail.ts';

const place = (patch: Partial<EncounterLocation['address']>, name: string | null = null) => ({
  name,
  address: { line: null, city: null, state: null, postalCode: null, ...patch }
});

export const claimDetail: ClaimDetail = {
  id: 'c1',
  number: '20261001-0012',
  patient_number: '20260915-0003',
  encounter_number: '20261001-0007',
  import_id: 'i1',
  import_file_name: 'october.xml',
  pcr_number: 'PCR-1001',
  level: 'ALS1',
  total_cents: 114_220,
  service_date: '2026-10-01',
  payers: ['Medicare', 'Blue Plan'],
  status: 'needs_review',
  created_at: '2026-10-01T00:00:00Z',
  first_name: 'Jane',
  last_name: 'Doe',
  encounter_revision: 1,
  encounter: {
    pcrNumber: 'PCR-1001',
    times: {
      call: null,
      unitNotified: null,
      enRoute: null,
      atScene: '2026-10-01T10:05:00Z',
      atPatient: null,
      leftScene: '2026-10-01T10:25:00Z',
      atDestination: '2026-10-01T10:40:00Z',
      transferOfCare: null,
      backInService: null
    },
    pickup: place({ line: '9 Elm St', state: '17', postalCode: '62704' }),
    destination: place({}, 'St. Mary'),
    narrative: 'Pt found sitting.'
  },
  classification: 'emergency',
  is_emergency: true,
  loaded_miles: '12.4',
  origin_code: null,
  transport_reason: 'A',
  condition_codes: ['06', '09'],
  weight_pounds: 180,
  destination_code: null,
  reasons: ['Emergency response', 'ALS assessment performed'],
  lines: [
    {
      position: 1,
      code: 'A0427',
      modifiers: ['RH'],
      units: 1,
      unit_cents: 95_000,
      total_cents: 95_000
    }
  ],
  birth_date: '1958-04-12',
  patient_id: 'p1',
  coverages: [
    {
      id: 'cov-m',
      position: 1,
      payer: 'Medicare',
      payer_id: 'p-m',
      member_id: '1EG4',
      group_id: null,
      relationship: '18',
      insured_first_name: null,
      insured_last_name: null
    },
    {
      id: 'cov-b',
      position: 2,
      payer: 'Blue Plan',
      payer_id: null,
      member_id: null,
      group_id: null,
      relationship: '01',
      insured_first_name: 'John',
      insured_last_name: 'Doe'
    }
  ],
  diagnoses: ['R079', 'I10'],
  address_line: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  postal_code: '62704'
};
