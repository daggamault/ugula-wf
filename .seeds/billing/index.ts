import type { SeedGraph } from '../graphs.ts';
import { balanceGraphs } from './balances.ts';
import { chargeGraphs } from './charges.ts';
import { checkFactGraphs } from './check-facts.ts';
import { checkGraphs } from './checks.ts';
import { claimGraphs } from './claim.ts';
import { claimTaskGraphs } from './claim-tasks.ts';
import { cycleGraphs } from './cycle.ts';
import { discoveryGraphs } from './discovery.ts';
import { displayGraphs } from './display.ts';
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
  ...displayGraphs,
  ...factGraphs,
  ...serviceGraphs,
  ...chargeGraphs,
  ...claimGraphs,
  ...checkFactGraphs,
  ...checkGraphs,
  ...facilityGraphs,
  ...documentGraphs,
  ...claimTaskGraphs,
  ...discoveryGraphs,
  ...intakeGraphs,
  ...recoveryGraphs,
  ...cycleGraphs,
  ...balanceGraphs,
  ...payerFileGraphs,
  ...scheduleGraphs
];

export const billingTables = shared.list();
