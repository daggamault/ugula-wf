import type { SeedGraph } from '../graphs.ts';
import { chargeGraphs } from './charges.ts';
import { checkGraphs } from './checks.ts';
import { claimGraphs } from './claim.ts';
import { claimTaskGraphs } from './claim-tasks.ts';
import { cycleGraphs } from './cycle.ts';
import { documentGraphs } from './documents.ts';
import { facilityGraphs } from './facility.ts';
import { factGraphs } from './facts.ts';
import { intakeGraphs } from './intake.ts';
import { payerFileGraphs } from './payer-files.ts';
import { recoveryGraphs } from './recovery.ts';
import { scheduleGraphs } from './schedules.ts';
import { serviceGraphs } from './service.ts';
import { shared } from './shared.ts';

export const billingGraphs: SeedGraph[] = [
  ...factGraphs,
  ...serviceGraphs,
  ...chargeGraphs,
  ...claimGraphs,
  ...checkGraphs,
  ...facilityGraphs,
  ...documentGraphs,
  ...claimTaskGraphs,
  ...intakeGraphs,
  ...recoveryGraphs,
  ...cycleGraphs,
  ...payerFileGraphs,
  ...scheduleGraphs
];

export const billingTables = shared.list();
