import { type Db, dependencyOf, findPublishedGraphs, type GraphKind } from '@ugula/db';
import {
  combineSources,
  createRegistry,
  deepEqual,
  ENTRY_TYPE,
  type GraphDef,
  graphRefs,
  type NodeDef,
  RETURN_TYPE,
  refKey,
  type Signature,
  stdGraphSource,
  validateGraph
} from '@ugula/graph';
import { isForeignKeyViolation, isUniqueViolation } from '../../shared/http.ts';
import { fail, ok } from '../../shared/result.ts';
import {
  deleteGraph,
  findDefinition,
  findGraph,
  findLatestPublished,
  findSystemGraph,
  findTenantGraph,
  findVersion,
  type GraphFilters,
  insertDraft,
  insertGraph,
  listPublishedNodes,
  listVersions,
  lockDraft,
  nextVersion,
  publishVersion,
  searchGraphs,
  setGraphActive,
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

const contract = (s: Signature) => ({
  execIn: s.execIn,
  execOut: s.execOut,
  inputs: s.inputs.map((p) => ({ name: p.name, type: p.type })),
  outputs: s.outputs.map((p) => ({ name: p.name, type: p.type }))
});

export const keepsContract = (system: Signature, override: Signature) =>
  deepEqual(contract(system), contract(override));

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
    return { issues: validateGraph(def, registry), dependencies: composites.map(dependencyOf) };
  };

  const editable = async (tx: Db, tenantId: string, graphId: string) => {
    const graph = await findGraph(tx, tenantId, graphId);
    if (!graph) return notFound;
    if (graph.tenant_id === null) return fail('forbidden', 'System graphs are read-only');
    return ok(graph);
  };

  return {
    search: async (tenantId: string, filters: GraphFilters) =>
      ok(await searchGraphs(db, tenantId, filters)),

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
      if (await findSystemGraph(db, input.key)) {
        return fail('conflict', 'A system graph uses that key; override it instead');
      }
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

    override: (tenantId: string, userId: string, graphId: string) =>
      db.transaction().execute(async (tx) => {
        const graph = await findGraph(tx, tenantId, graphId);
        if (!graph) return notFound;
        if (graph.tenant_id !== null)
          return fail('conflict', 'Only system graphs can be overridden');
        const copy = await findTenantGraph(tx, tenantId, graph.key);
        if (copy?.is_active) return fail('conflict', 'This graph is already overridden');
        if (copy) {
          await setGraphActive(tx, tenantId, copy.id, true);
          return ok({ id: copy.id });
        }
        const latest = await findLatestPublished(tx, graph.id);
        if (!latest) return fail('conflict', 'This graph has no published version to start from');
        try {
          const { id } = await insertGraph(tx, {
            tenantId,
            key: graph.key,
            name: graph.name,
            kind: graph.kind,
            description: graph.description
          });
          await insertDraft(tx, {
            graphId: id,
            version: 1,
            definition: latest.definition as GraphDef,
            userId
          });
          return ok({ id });
        } catch (err) {
          if (isUniqueViolation(err)) return fail('conflict', 'This graph is already overridden');
          throw err;
        }
      }),

    remove: async (tenantId: string, graphId: string) => {
      const graph = await findGraph(db, tenantId, graphId);
      if (!graph || graph.tenant_id === null) return notFound;
      if (graph.overrides) {
        await setGraphActive(db, tenantId, graphId, false);
        return ok({ id: graphId });
      }
      try {
        return (await deleteGraph(db, tenantId, graphId)) ? ok({ id: graphId }) : notFound;
      } catch (err) {
        if (isForeignKeyViolation(err)) {
          return fail('conflict', 'Runs still use this graph, so it cannot be removed');
        }
        throw err;
      }
    },

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
        const system = await findSystemGraph(tx, graph.value.key);
        const original = system && (await findLatestPublished(tx, system.id));
        if (
          original &&
          !keepsContract(
            (original.definition as GraphDef).signature,
            (await findDefinition(tx, draft.id)).signature
          )
        ) {
          return fail(
            'invalid',
            'An override must keep the inputs, outputs and exits of the graph it replaces'
          );
        }
        await publishVersion(tx, draft.id, dependencies);
        await touchGraph(tx, graphId);
        return ok({ version: draft.version });
      })
  };
};

export type GraphService = ReturnType<typeof createGraphService>;
