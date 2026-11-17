import type { ValueKinds } from '@ugula/graph';

export const billingKinds: ValueKinds = {
  id: {
    claim: 'Claim ID',
    coverage: 'Coverage ID',
    document: 'Document ID',
    facility: 'Facility ID',
    patient: 'Patient ID',
    payer: 'Payer ID',
    payerFile: 'Payer File ID',
    task: 'Task ID'
  },
  code: {
    carc: 'Adjustment Reason Code',
    hcpcs: 'HCPCS Code',
    icd10: 'ICD-10 Code',
    modifier: 'Modifier',
    rarc: 'Remark Code'
  }
};
