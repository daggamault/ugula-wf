import type { SeedGraph } from '../graphs.ts';
import { chargeGraphs } from './charges.ts';
import { checkGraphs } from './checks.ts';
import { claimGraphs } from './claims.ts';
import { diagnosisGraphs } from './diagnoses.ts';
import { importGraphs } from './imports.ts';
import { patientGraphs } from './patients.ts';
import { payerGraphs } from './payers.ts';
import { remittanceGraphs } from './remittances.ts';
import { serviceGraphs } from './service.ts';
import { shared } from './shared.ts';
import { tripGraphs } from './trip.ts';

export const billingGraphs: SeedGraph[] = [
  ...importGraphs,
  ...tripGraphs,
  ...serviceGraphs,
  ...diagnosisGraphs,
  ...patientGraphs,
  ...payerGraphs,
  ...chargeGraphs,
  ...checkGraphs,
  ...claimGraphs,
  ...remittanceGraphs
];

export const billingTables = shared.list();
