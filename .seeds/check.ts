import { billingGraphs, billingTables } from './billing/index.ts';
import { graphNodes, seedProblems } from './validate.ts';

const nodes = graphNodes();
const problems = seedProblems(billingGraphs, billingTables, nodes);
if (problems.length) {
  process.stderr.write(`Invalid seeds:\n${problems.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `${billingGraphs.length} graphs and ${billingTables.length} tables are valid\n`
  );
}
