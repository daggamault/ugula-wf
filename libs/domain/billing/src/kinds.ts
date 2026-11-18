import type { ValueKinds } from '@ugula/graph';

export const billingKinds: ValueKinds = {
  id: {
    claim: 'Claim ID',
    clearinghouseFile: 'Clearinghouse File ID',
    patient: 'Patient ID',
    payment: 'Payment ID',
    remittance: 'Remittance ID',
    payer: 'Payer ID',
    task: 'Task ID'
  },
  code: {
    claimDecision: 'Claim Decision',
    claimSettlement: 'Claim Settlement',
    fileKind: 'Clearinghouse File Kind',
    hcpcs: 'HCPCS Code',
    icd10: 'ICD-10 Code',
    levelOfService: 'Level of Service',
    modifier: 'Modifier',
    nextStep: 'Next Step After Payment',
    paymentOutcome: 'Payment Outcome',
    placeCode: 'Origin or Destination Code',
    tripClassification: 'Trip Classification',
    x12Relationship: 'X12 Relationship Code'
  }
};
