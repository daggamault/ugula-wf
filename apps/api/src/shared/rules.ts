import { type Db, findGraphTables, findRuleBundle } from '@ugula/db';
import {
  combineSources,
  type GraphDef,
  graphDefSchema,
  inlineTables,
  type Json,
  type NodeDef,
  type ResolvedTable,
  refKey,
  runRule,
  stdGraphSource,
  type Values
} from '@ugula/graph';
import * as v from 'valibot';

export type RuleRunner = (
  agencyId: string,
  key: string,
  inputs: Values,
  now: Date
) => Promise<Values>;

export const createRuleRunner =
  (db: Db, nodes: NodeDef[]): RuleRunner =>
  async (agencyId, key, inputs, now) => {
    const rows = await findRuleBundle(db, agencyId, key);
    const root = rows.filter((r) => r.key === key).at(-1);
    if (!root) throw new Error(`The rule ${key} is not published`);
    const tables = new Map<string, ResolvedTable>(
      (await findGraphTables(db, agencyId, [...new Set(rows.map((r) => r.id))])).map((t) => [
        t.key,
        { kind: t.kind, definition: t.definition as Json }
      ])
    );
    const graphs = new Map<string, GraphDef>(
      rows.map((r) => [
        refKey({ type: r.key, version: r.version }),
        inlineTables(v.parse(graphDefSchema, r.definition), (k) => tables.get(k))
      ])
    );
    return runRule(
      { nodes, graphs: combineSources(stdGraphSource, (ref) => graphs.get(refKey(ref))) },
      { type: root.key, version: root.version },
      inputs,
      now
    );
  };
