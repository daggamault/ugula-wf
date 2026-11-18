const SIGNATURE_STATUSES = ['signed', 'exception', 'refused', 'missing'] as const;

type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];

const TRANSPORT_REASONS = {
  A: 'Nearest facility for care of symptoms or complaints',
  B: 'For the benefit of a preferred physician',
  C: 'For the nearness of family members',
  D: 'For a specialist or equipment',
  E: 'Transfer to a rehabilitation facility'
} as const;

type TransportReason = keyof typeof TRANSPORT_REASONS;

const _AMBULANCE_CONDITIONS = {
  '01': 'Patient was admitted to a hospital',
  '04': 'Patient was moved by stretcher',
  '05': 'Patient was unconscious or in shock',
  '06': 'Patient was transported in an emergency situation',
  '07': 'Patient had to be physically restrained',
  '08': 'Patient had visible hemorrhaging',
  '09': 'Ambulance service was medically necessary',
  '12': 'Patient is confined to a bed or chair'
} as const;

const _CONDITION_LIMIT = 5;

const MSP_ACCIDENTS = {
  none: 'No accident, injury or illness someone else pays for',
  liability: 'Liability insurance of someone at fault',
  noFault: 'No-fault or auto insurance',
  workersComp: "Workers' compensation"
} as const;

type MspAccident = keyof typeof MSP_ACCIDENTS;

const PCS_TYPES = {
  repetitive: 'Repetitive scheduled transports (valid 60 days)',
  nonRepetitive: 'One non-emergency transport'
} as const;

type PcsType = keyof typeof PCS_TYPES;

const FACILITY_STAYS = {
  none: 'Not in a facility stay',
  inpatient: 'Hospital inpatient stay (Part A)',
  snf: 'Skilled nursing facility stay (Part A)'
} as const;

type FacilityStay = keyof typeof FACILITY_STAYS;

export type Documentation = {
  signature: SignatureStatus;
  signatureNote: string | null;
  pcsOnFile: boolean | null;
  pcsSignedOn: string | null;
  transportReason: TransportReason | null;
  conditionCodes: string[];
  priorAuthorization: string | null;
  weightKg: number | null;
  atScene: string | null;
  leftScene: string | null;
  atDestination: string | null;
  patientCount: number | null;
  closestFacilityMiles: number | null;
  abnOnFile: boolean | null;
  abnSignedOn: string | null;
  denialExpected: boolean | null;
  mspEmployerPlan: boolean | null;
  mspEsrd: boolean | null;
  mspDisability: boolean | null;
  mspEmployerSize: number | null;
  mspAccident: MspAccident | null;
  priorAuthorizationExpiresOn: string | null;
  pcsType: PcsType | null;
  roundTrips: number | null;
  admissionDate: string | null;
  facilityStay: FacilityStay | null;
};
