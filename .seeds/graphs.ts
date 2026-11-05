import { type Database, dependencyOf, type GraphKind, type GraphRole } from '@ugula/db';
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
  role: GraphRole;
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
      role: graph.role,
      description: graph.description
    })
    .onConflict((oc) =>
      oc.columns(['organization_id', 'agency_id', 'key']).doUpdateSet({
        name: graph.name,
        kind: graph.kind,
        role: graph.role,
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

const inSubgraphOrder = (graphs: readonly SeedGraph[]) => {
  const byKey = new Map(graphs.map((g) => [g.key, g]));
  const ordered: SeedGraph[] = [];
  const placed = new Set<string>();
  const place = (g: SeedGraph, path: string[]) => {
    if (placed.has(g.key)) return;
    if (path.includes(g.key)) {
      throw new Error(`Seed graphs call each other: ${[...path, g.key].join(' > ')}`);
    }
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

type Latest = NonNullable<Awaited<ReturnType<typeof findLatest>>>;

type Stored = { graph: SeedGraph; id: string; latest: Latest | undefined };

const planOf = (
  graph: SeedGraph,
  primitives: ReadonlySet<string>,
  versions: ReadonlyMap<string, number>
) => {
  const definition = retargetRefs(graph.definition, (key) => versions.get(key));
  const subgraphs = graphRefs(definition).filter(
    (r) => !r.type.startsWith('std.') && !primitives.has(refKey(r))
  );
  const dependencies = [...subgraphs, ...workflowRefs(definition)]
    .map((r) => dependencyOf({ key: r.type, version: r.version }))
    .filter((d, i, all) => all.indexOf(d) === i)
    .sort();
  return { definition, dependencies, subgraphs };
};

const isStored = (latest: Latest | undefined, plan: ReturnType<typeof planOf>) =>
  latest !== undefined &&
  deepEqual(latest.definition as Json, plan.definition as unknown as Json) &&
  deepEqual([...latest.dependencies].sort(), plan.dependencies);

export const publishGraphs = async (
  db: Kysely<Database>,
  graphs: SeedGraph[],
  primitives: ReadonlySet<string>
) => {
  const versions = await findPublishedVersions(
    db,
    graphs.map((g) => g.key)
  );
  const stored: Stored[] = [];
  for (const graph of inSubgraphOrder(graphs)) {
    const { id } = await buildUpsertGraph(db, graph).executeTakeFirstOrThrow();
    stored.push({ graph, id, latest: await findLatest(db, id) });
  }
  const changed = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const { graph, latest } of stored) {
      if (changed.has(graph.key) || isStored(latest, planOf(graph, primitives, versions))) continue;
      changed.add(graph.key);
      versions.set(graph.key, (latest?.version ?? 0) + 1);
      grew = true;
    }
  }
  for (const { graph, id } of stored) {
    if (!changed.has(graph.key)) continue;
    const plan = planOf(graph, primitives, versions);
    const missing = plan.subgraphs.filter((r) => versions.get(r.type) !== r.version);
    if (missing.length) {
      throw new Error(`${graph.key} depends on unpublished ${missing.map(refKey).join(', ')}`);
    }
    const version = versions.get(graph.key) ?? 1;
    await buildInsertVersion(db, id, version, plan.definition, plan.dependencies).execute();
  }
};
