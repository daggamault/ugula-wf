import type { ValueKinds } from '@ugula/graph';

export const billingKinds: ValueKinds = {
  id: {
    claim: 'Claim ID',
    patient: 'Patient ID',
    payer: 'Payer ID',
    task: 'Task ID'
  },
  code: {
    claimDecision: 'Claim Decision',
    hcpcs: 'HCPCS Code',
    icd10: 'ICD-10 Code',
    levelOfService: 'Level of Service',
    modifier: 'Modifier',
    placeCode: 'Origin or Destination Code',
    tripClassification: 'Trip Classification',
    x12Relationship: 'X12 Relationship Code'
  }
};
