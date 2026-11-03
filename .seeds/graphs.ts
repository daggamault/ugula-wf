import {
  type Database,
  dependencyOf,
  findPublishedGraphs,
  type GraphKind,
  PUBLISHED_IMMUTABLE_TRIGGER
} from '@ugula/db';
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

export const buildUpsertPublishedVersion = (
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
    .onConflict((oc) =>
      oc
        .columns(['graph_id', 'version'])
        .doUpdateSet({
          definition: (eb) => eb.ref('excluded.definition'),
          dependencies: (eb) => eb.ref('excluded.dependencies'),
          updated_at: sql`now()`
        })
        .where((eb) =>
          eb.or([
            eb('graph_versions.definition', 'is distinct from', eb.ref('excluded.definition')),
            eb('graph_versions.dependencies', 'is distinct from', eb.ref('excluded.dependencies'))
          ])
        )
    );

const publishGraph = async (
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
  await buildUpsertPublishedVersion(db, id, graph, deps.map(dependencyOf)).execute();
};

const immutability = (enabled: boolean) =>
  sql`alter table graph_versions ${sql.raw(enabled ? 'enable' : 'disable')} trigger ${sql.id(PUBLISHED_IMMUTABLE_TRIGGER)}`;

export const publishGraphs = async (
  db: Kysely<Database>,
  graphs: SeedGraph[],
  primitives: ReadonlySet<string>
) => {
  await immutability(false).execute(db);
  for (const graph of graphs) await publishGraph(db, graph, primitives);
  await immutability(true).execute(db);
};
