import { type Db, findPublishedGraphs, type GraphKind } from '@ugula/db';
import {
  combineSources,
  createRegistry,
  ENTRY_TYPE,
  type GraphDef,
  graphRefs,
  type NodeDef,
  RETURN_TYPE,
  refKey,
  stdGraphSource,
  validateGraph
} from '@ugula/graph';
import { isUniqueViolation } from '../../shared/http.ts';
import { fail, ok } from '../../shared/result.ts';
import {
  findDefinition,
  findGraph,
  findVersion,
  insertDraft,
  insertGraph,
  listGraphs,
  listPublishedNodes,
  listVersions,
  lockDraft,
  nextVersion,
  publishVersion,
  touchGraph,
  updateDraft
} from './queries.ts';

export type GraphServiceDeps = {
  db: Db;
  nodes: NodeDef[];
};

export type NewGraph = {
  key: string;
  name: string;
  kind: GraphKind;
  description: string;
};

export const templateFor = (kind: GraphKind): GraphDef => ({
  signature: {
    execIn: ['exec'],
    execOut: kind === 'node' ? ['then'] : [],
    inputs: [],
    outputs: []
  },
  variables: [],
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1, position: { x: 0, y: 0 } },
    ...(kind === 'node'
      ? [{ id: 'return', type: RETURN_TYPE, version: 1, position: { x: 480, y: 0 } }]
      : [])
  ],
  edges: kind === 'node' ? [{ from: 'entry', fromPin: 'exec', to: 'return', toPin: 'exec' }] : []
});

const notFound = fail('not_found', 'Graph not found');

export const createGraphService = ({ db, nodes }: GraphServiceDeps) => {
  const primitives = new Set(nodes.map(refKey));

  const check = async (tx: Db, tenantId: string, def: GraphDef) => {
    const refs = graphRefs(def)
      .filter((r) => !r.type.startsWith('std.') && !primitives.has(refKey(r)))
      .map((r) => ({ key: r.type, version: r.version }));
    const composites = await findPublishedGraphs(tx, tenantId, refs);
    const byRef = new Map(
      composites.map((c) => [refKey({ type: c.key, version: c.version }), c.definition as GraphDef])
    );
    const registry = createRegistry(
      nodes,
      combineSources(stdGraphSource, (ref) => byRef.get(refKey(ref)))
    );
    return { issues: validateGraph(def, registry), dependencies: composites.map((c) => c.id) };
  };

  const editable = async (tx: Db, tenantId: string, graphId: string) => {
    const graph = await findGraph(tx, tenantId, graphId);
    if (!graph) return notFound;
    if (graph.tenant_id === null) return fail('forbidden', 'System graphs are read-only');
    return ok(graph);
  };

  return {
    list: async (tenantId: string) => ok({ graphs: await listGraphs(db, tenantId) }),

    nodes: async (tenantId: string) => ok({ nodes: await listPublishedNodes(db, tenantId) }),

    find: async (tenantId: string, id: string) => {
      const graph = await findGraph(db, tenantId, id);
      return graph ? ok({ graph, versions: await listVersions(db, id) }) : notFound;
    },

    version: async (tenantId: string, id: string, version: number) => {
      const found = (await findGraph(db, tenantId, id)) && (await findVersion(db, id, version));
      return found ? ok(found) : fail('not_found', 'Version not found');
    },

    validate: async (tenantId: string, def: GraphDef) =>
      ok({ issues: (await check(db, tenantId, def)).issues }),

    create: async (tenantId: string, userId: string, input: NewGraph) => {
      try {
        return ok(
          await db.transaction().execute(async (tx) => {
            const { id } = await insertGraph(tx, { tenantId, ...input });
            await insertDraft(tx, {
              graphId: id,
              version: 1,
              definition: templateFor(input.kind),
              userId
            });
            return { id };
          })
        );
      } catch (err) {
        if (isUniqueViolation(err)) return fail('conflict', 'A graph with that key exists');
        throw err;
      }
    },

    saveDraft: (tenantId: string, userId: string, graphId: string, def: GraphDef) =>
      db.transaction().execute(async (tx) => {
        const graph = await editable(tx, tenantId, graphId);
        if (!graph.ok) return graph;
        const draft = await lockDraft(tx, graphId);
        if (draft) await updateDraft(tx, draft.id, def);
        const version = draft
          ? draft.version
          : (
              await insertDraft(tx, {
                graphId,
                version: await nextVersion(tx, graphId),
                definition: def,
                userId
              })
            ).version;
        await touchGraph(tx, graphId);
        return ok({ version, issues: (await check(tx, tenantId, def)).issues });
      }),

    publish: (tenantId: string, graphId: string) =>
      db.transaction().execute(async (tx) => {
        const graph = await editable(tx, tenantId, graphId);
        if (!graph.ok) return graph;
        const draft = await lockDraft(tx, graphId);
        if (!draft) return fail('conflict', 'Nothing to publish');
        const { issues, dependencies } = await check(
          tx,
          tenantId,
          await findDefinition(tx, draft.id)
        );
        if (issues.length) return fail('invalid', 'Fix the issues before publishing', { issues });
        await publishVersion(tx, draft.id, dependencies);
        await touchGraph(tx, graphId);
        return ok({ version: draft.version });
      })
  };
};

export type GraphService = ReturnType<typeof createGraphService>;
