import { type Database, dependencyOf, findPublishedGraphs, type GraphKind } from '@ugula/db';
import { type GraphDef, graphRefs, refKey } from '@ugula/graph';
import { type Kysely, sql } from 'kysely';

export type SeedGraph = {
  key: string;
  name: string;
  kind: GraphKind;
  description: string;
  version: number;
  definition: GraphDef;
};

export const buildUpsertGraph = (db: Kysely<Database>, graph: SeedGraph) =>
  db
    .insertInto('graphs')
    .values({
      tenant_id: null,
      key: graph.key,
      name: graph.name,
      kind: graph.kind,
      description: graph.description
    })
    .onConflict((oc) =>
      oc.columns(['tenant_id', 'key']).doUpdateSet({
        name: graph.name,
        kind: graph.kind,
        description: graph.description,
        updated_at: sql`now()`
      })
    )
    .returning('id');

export const buildInsertPublishedVersion = (
  db: Kysely<Database>,
  graphId: string,
  graph: SeedGraph,
  dependencies: string[]
) =>
  db
    .insertInto('graph_versions')
    .values({
      graph_id: graphId,
      version: graph.version,
      definition: JSON.stringify(graph.definition),
      dependencies,
      published_at: sql`now()`
    })
    .onConflict((oc) => oc.columns(['graph_id', 'version']).doNothing());

export const publishGraph = async (
  db: Kysely<Database>,
  graph: SeedGraph,
  primitives: ReadonlySet<string>
) => {
  const { id } = await buildUpsertGraph(db, graph).executeTakeFirstOrThrow();
  const refs = graphRefs(graph.definition)
    .filter((r) => !r.type.startsWith('std.') && !primitives.has(refKey(r)))
    .map((r) => ({ key: r.type, version: r.version }));
  const deps = await findPublishedGraphs(db, null, refs);
  const missing = refs.filter((r) => !deps.some((d) => d.key === r.key && d.version === r.version));
  if (missing.length) {
    throw new Error(
      `${graph.key} depends on unpublished ${missing.map((r) => `${r.key}@${r.version}`).join(', ')}`
    );
  }
  await buildInsertPublishedVersion(db, id, graph, deps.map(dependencyOf)).execute();
};
