import type { SeedGraph } from '../graphs.ts';
import { chargeGraphs } from './charges.ts';
import { claimGraphs } from './claims.ts';
import { importGraphs } from './imports.ts';
import { patientGraphs } from './patients.ts';
import { payerGraphs } from './payers.ts';
import { serviceGraphs } from './service.ts';
import { shared } from './shared.ts';

export const billingGraphs: SeedGraph[] = [
  ...importGraphs,
  ...serviceGraphs,
  ...patientGraphs,
  ...payerGraphs,
  ...chargeGraphs,
  ...claimGraphs
];

export const billingTables = shared.list();
