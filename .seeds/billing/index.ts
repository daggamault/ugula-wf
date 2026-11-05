import { graphRefs } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import { chargeGraphs } from './charges.ts';
import { checkGraphs } from './checks.ts';
import { claimGraphs } from './claim.ts';
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

const inDependencyOrder = (graphs: SeedGraph[]) => {
  const byKey = new Map(graphs.map((g) => [g.key, g]));
  const ordered: SeedGraph[] = [];
  const placed = new Set<string>();
  const place = (g: SeedGraph, path: string[]) => {
    if (placed.has(g.key)) return;
    if (path.includes(g.key))
      throw new Error(`Seed graphs call each other: ${[...path, g.key].join(' > ')}`);
    for (const ref of graphRefs(g.definition)) {
      const dependency = byKey.get(ref.type);
      if (dependency) place(dependency, [...path, g.key]);
    }
    placed.add(g.key);
    ordered.push(g);
  };
  for (const g of graphs) place(g, []);
  return ordered;
};

const all = [
  ...factGraphs,
  ...serviceGraphs,
  ...chargeGraphs,
  ...claimGraphs,
  ...checkGraphs,
  ...facilityGraphs,
  ...documentGraphs,
  ...intakeGraphs,
  ...recoveryGraphs,
  ...cycleGraphs,
  ...payerFileGraphs,
  ...scheduleGraphs
];

export const billingGraphs: SeedGraph[] = inDependencyOrder(all);

export const billingTables = shared.list();
