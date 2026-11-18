import type { ValueKinds } from '@ugula/graph';

export const billingKinds: ValueKinds = {
  id: {
    claim: 'Claim ID',
    patient: 'Patient ID',
    payer: 'Payer ID',
    task: 'Task ID'
  },
  code: {
    hcpcs: 'HCPCS Code',
    icd10: 'ICD-10 Code',
    modifier: 'Modifier'
  }
};
