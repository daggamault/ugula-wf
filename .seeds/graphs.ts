import { type Database, dependencyOf, type GraphKind } from '@ugula/db';
import {
  contractOf,
  deepEqual,
  type GraphDef,
  graphRefs,
  type Json,
  refKey,
  retargetRefs,
  workflowRefs
} from '@ugula/graph';
import { type Kysely, sql } from 'kysely';

export type SeedGraph = {
  key: string;
  name: string;
  kind: GraphKind;
  description: string;
  version: number;
  definition: GraphDef;
};

const buildUpsertGraph = (db: Kysely<Database>, graph: SeedGraph) =>
  db
    .insertInto('graphs')
    .values({
      organization_id: null,
      agency_id: null,
      key: graph.key,
      name: graph.name,
      kind: graph.kind,
      description: graph.description
    })
    .onConflict((oc) =>
      oc.columns(['organization_id', 'agency_id', 'key']).doUpdateSet({
        name: graph.name,
        kind: graph.kind,
        description: graph.description,
        updated_at: sql`now()`
      })
    )
    .returning('id');

const findLatest = (db: Kysely<Database>, graphId: string) =>
  db
    .selectFrom('graph_versions')
    .select(['version', 'definition', 'dependencies'])
    .where('graph_id', '=', graphId)
    .where('published_at', 'is not', null)
    .orderBy('version', 'desc')
    .limit(1)
    .executeTakeFirst();

const buildInsertVersion = (
  db: Kysely<Database>,
  graphId: string,
  version: number,
  definition: GraphDef,
  dependencies: string[]
) =>
  db.insertInto('graph_versions').values({
    graph_id: graphId,
    version,
    definition: JSON.stringify(definition),
    contract: contractOf(definition.signature),
    dependencies,
    published_at: sql`now()`
  });

const findPublishedVersions = async (db: Kysely<Database>, keys: string[]) =>
  new Map(
    (
      await db
        .selectFrom('graphs as g')
        .innerJoin('graph_versions as v', 'v.graph_id', 'g.id')
        .select(['g.key', (eb) => eb.fn.max('v.version').as('version')])
        .where('g.organization_id', 'is', null)
        .where('g.key', 'in', keys.length ? keys : [''])
        .where('v.published_at', 'is not', null)
        .groupBy('g.key')
        .execute()
    ).map((r) => [r.key, r.version])
  );

const publishGraph = async (
  db: Kysely<Database>,
  graph: SeedGraph,
  primitives: ReadonlySet<string>,
  versions: Map<string, number>
) => {
  const definition = retargetRefs(graph.definition, (key) => versions.get(key));
  const subgraphs = graphRefs(definition).filter(
    (r) => !r.type.startsWith('std.') && !primitives.has(refKey(r))
  );
  const missing = subgraphs.filter((r) => versions.get(r.type) !== r.version);
  if (missing.length) {
    throw new Error(`${graph.key} depends on unpublished ${missing.map(refKey).join(', ')}`);
  }
  const dependencies = [...subgraphs, ...workflowRefs(definition)]
    .map((r) => dependencyOf({ key: r.type, version: r.version }))
    .filter((d, i, all) => all.indexOf(d) === i)
    .sort();
  const { id } = await buildUpsertGraph(db, graph).executeTakeFirstOrThrow();
  const latest = await findLatest(db, id);
  if (
    latest &&
    deepEqual(latest.definition as Json, definition as unknown as Json) &&
    deepEqual([...latest.dependencies].sort(), dependencies)
  ) {
    versions.set(graph.key, latest.version);
    return;
  }
  const version = (latest?.version ?? 0) + 1;
  await buildInsertVersion(db, id, version, definition, dependencies).execute();
  versions.set(graph.key, version);
};

export const publishGraphs = async (
  db: Kysely<Database>,
  graphs: SeedGraph[],
  primitives: ReadonlySet<string>
) => {
  const versions = await findPublishedVersions(
    db,
    graphs.map((g) => g.key)
  );
  for (const graph of graphs) await publishGraph(db, graph, primitives, versions);
};
