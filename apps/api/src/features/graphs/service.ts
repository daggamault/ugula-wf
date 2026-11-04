import { type Db, dependencyOf, findPublishedGraphs, type GraphKind } from '@ugula/db';
import {
  combineSources,
  contractOf,
  createRegistry,
  ENTRY_TYPE,
  type GraphDef,
  graphRefs,
  type NodeDef,
  RETURN_TYPE,
  refKey,
  stdGraphSource,
  validateGraph,
  workflowRefs
} from '@ugula/graph';
import { type AgencyAccess, hasPermission } from '../../shared/access.ts';
import { isForeignKeyViolation, isUniqueViolation } from '../../shared/http.ts';
import { fail, ok } from '../../shared/result.ts';
import {
  deleteGraph,
  findDraft,
  findEffectiveGraph,
  findGraph,
  findNewestPublishedVersion,
  findScopedGraph,
  findSystemGraph,
  findVersion,
  findVersionById,
  type GraphFilters,
  type GraphScope,
  insertDraft,
  insertGraph,
  listPublishedNodes,
  listVersions,
  nextVersion,
  publishVersion,
  type ScopeIds,
  searchGraphs,
  setGraphActive,
  touchGraph,
  updateDraft
} from './queries.ts';

type GraphServiceDeps = {
  db: Db;
  nodes: NodeDef[];
};

export type EditScope = Exclude<GraphScope, 'system'>;

type NewGraph = {
  key: string;
  name: string;
  kind: GraphKind;
  description: string;
  scope: EditScope;
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

const forbidden = (scope: EditScope) =>
  fail(
    'forbidden',
    scope === 'organization'
      ? 'Only organization owners can change organization workflows'
      : 'You do not have permission to change this graph'
  );

const RANK: Record<GraphScope, number> = { agency: 0, organization: 1, system: 2 };

export const canEditScope = (access: AgencyAccess, scope: GraphScope, kind: GraphKind) =>
  scope === 'system'
    ? false
    : scope === 'organization'
      ? access.isOrganizationAdmin
      : hasPermission(access, kind === 'workflow' ? 'workflows:manage' : 'workflows:update');

const scopeIds = (access: AgencyAccess): ScopeIds => ({
  agencyId: access.agencyId,
  organizationId: access.organizationId
});

const ownerOf = (access: AgencyAccess, scope: EditScope) => ({
  organizationId: access.organizationId,
  agencyId: scope === 'agency' ? access.agencyId : null
});

export const createGraphService = ({ db, nodes }: GraphServiceDeps) => {
  const primitives = new Set(nodes.map(refKey));
  const check = async (tx: Db, access: AgencyAccess, def: GraphDef) => {
    const refs = graphRefs(def)
      .filter((r) => !r.type.startsWith('std.') && !primitives.has(refKey(r)))
      .map((r) => ({ key: r.type, version: r.version }));
    const composites = await findPublishedGraphs(tx, access.agencyId, refs);
    const byRef = new Map(
      composites.map((c) => [refKey({ type: c.key, version: c.version }), c.definition as GraphDef])
    );
    const registry = createRegistry(
      nodes,
      combineSources(stdGraphSource, (ref) => byRef.get(refKey(ref)))
    );
    const calls = workflowRefs(def).map((r) => dependencyOf({ key: r.type, version: r.version }));
    return {
      issues: validateGraph(def, registry),
      dependencies: [...new Set([...composites.map(dependencyOf), ...calls])]
    };
  };
  const editable = async (tx: Db, access: AgencyAccess, graphId: string) => {
    const graph = await findGraph(tx, scopeIds(access), graphId);
    if (!graph) return notFound;
    if (graph.scope === 'system') return fail('forbidden', 'Built-in graphs are read-only');
    if (!canEditScope(access, graph.scope, graph.kind)) return forbidden(graph.scope);
    return ok({ ...graph, scope: graph.scope as EditScope });
  };
  const baseOf = async (
    tx: Db,
    access: AgencyAccess,
    graph: { key: string; scope: GraphScope }
  ) => {
    const below = await findEffectiveBelow(tx, access, graph.key, RANK[graph.scope]);
    return below ? findNewestPublishedVersion(tx, below) : undefined;
  };
  const findEffectiveBelow = async (tx: Db, access: AgencyAccess, key: string, rank: number) => {
    const ids = scopeIds(access);
    if (rank === 0) {
      const org = await findScopedGraph(
        tx,
        { organizationId: ids.organizationId, agencyId: null },
        key
      );
      if (org?.is_active) return org.id;
    }
    return (await findSystemGraph(tx, key))?.id;
  };
  return {
    search: async (access: AgencyAccess, filters: GraphFilters) =>
      ok(await searchGraphs(db, scopeIds(access), filters)),
    nodes: async (access: AgencyAccess) =>
      ok({ nodes: await listPublishedNodes(db, scopeIds(access)) }),
    find: async (access: AgencyAccess, id: string) => {
      const graph = await findGraph(db, scopeIds(access), id);
      if (!graph) return notFound;
      const effective = await findEffectiveGraph(db, scopeIds(access), graph.key);
      return ok({
        graph: {
          ...graph,
          canEdit: canEditScope(access, graph.scope, graph.kind),
          canOverride: {
            organization: graph.scope === 'system' && access.isOrganizationAdmin,
            agency: graph.scope !== 'agency' && canEditScope(access, 'agency', graph.kind)
          },
          effectiveId: effective?.id ?? graph.id
        },
        versions: await listVersions(db, id)
      });
    },
    version: async (access: AgencyAccess, id: string, version: number) => {
      const found =
        (await findGraph(db, scopeIds(access), id)) && (await findVersion(db, id, version));
      return found ? ok(found) : fail('not_found', 'Version not found');
    },
    compare: async (access: AgencyAccess, id: string) => {
      const graph = await findGraph(db, scopeIds(access), id);
      if (!graph) return notFound;
      if (graph.scope === 'system')
        return ok({ mine: null, copiedFrom: null, latest: null, baseChanged: false });
      const versions = await listVersions(db, id);
      const head = versions[0];
      const mine = head ? await findVersion(db, id, head.version) : undefined;
      const copied = mine?.base_version_id
        ? await findVersionById(db, mine.base_version_id)
        : undefined;
      const latest = await baseOf(db, access, graph);
      return ok({
        mine: mine ? { version: mine.version, definition: mine.definition } : null,
        copiedFrom: copied
          ? {
              graphId: copied.graph_id,
              scope: copied.scope,
              version: copied.version,
              definition: copied.definition
            }
          : null,
        latest: latest ? { version: latest.version, definition: latest.definition } : null,
        baseChanged: !!latest && !!copied && latest.id !== copied.id
      });
    },
    validate: async (access: AgencyAccess, def: GraphDef) =>
      ok({ issues: (await check(db, access, def)).issues }),
    create: async (access: AgencyAccess, input: NewGraph) => {
      if (!canEditScope(access, input.scope, input.kind)) return forbidden(input.scope);
      if (await findSystemGraph(db, input.key)) {
        return fail('conflict', 'A built-in graph uses that key; override it instead');
      }
      try {
        return ok(
          await db.transaction().execute(async (tx) => {
            const { id } = await insertGraph(tx, {
              ...ownerOf(access, input.scope),
              key: input.key,
              name: input.name,
              kind: input.kind,
              description: input.description
            });
            await insertDraft(tx, {
              graphId: id,
              version: 1,
              definition: templateFor(input.kind),
              baseVersionId: null,
              userId: access.userId
            });
            return { id };
          })
        );
      } catch (err) {
        if (isUniqueViolation(err)) return fail('conflict', 'A graph with that key exists');
        throw err;
      }
    },
    saveDraft: (access: AgencyAccess, graphId: string, def: GraphDef) =>
      db.transaction().execute(async (tx) => {
        const graph = await editable(tx, access, graphId);
        if (!graph.ok) return graph;
        const draft = await findDraft(tx, graphId);
        if (draft) await updateDraft(tx, draft.id, def);
        const version = draft
          ? draft.version
          : (
              await insertDraft(tx, {
                graphId,
                version: await nextVersion(tx, graphId),
                definition: def,
                baseVersionId: (await baseOf(tx, access, graph.value))?.id ?? null,
                userId: access.userId
              })
            ).version;
        await touchGraph(tx, graphId);
        return ok({ version, issues: (await check(tx, access, def)).issues });
      }),
    override: (access: AgencyAccess, graphId: string, scope: EditScope) =>
      db.transaction().execute(async (tx) => {
        const graph = await findGraph(tx, scopeIds(access), graphId);
        if (!graph) return notFound;
        if (RANK[graph.scope] <= RANK[scope]) {
          return fail('conflict', `This graph cannot be overridden for the ${scope}`);
        }
        if (!canEditScope(access, scope, graph.kind)) return forbidden(scope);
        const owner = ownerOf(access, scope);
        const copy = await findScopedGraph(tx, owner, graph.key);
        if (copy?.is_active) return fail('conflict', 'This graph is already overridden');
        if (copy) {
          await setGraphActive(tx, copy.id, true);
          return ok({ id: copy.id });
        }
        const latest = await findNewestPublishedVersion(tx, graph.id);
        if (!latest) return fail('conflict', 'This graph has no published version to start from');
        try {
          const { id } = await insertGraph(tx, {
            ...owner,
            key: graph.key,
            name: graph.name,
            kind: graph.kind,
            description: graph.description
          });
          await insertDraft(tx, {
            graphId: id,
            version: 1,
            definition: latest.definition as GraphDef,
            baseVersionId: latest.id,
            userId: access.userId
          });
          return ok({ id });
        } catch (err) {
          if (isUniqueViolation(err)) return fail('conflict', 'This graph is already overridden');
          throw err;
        }
      }),
    rebase: (access: AgencyAccess, graphId: string, mode: 'keep' | 'reset') =>
      db.transaction().execute(async (tx) => {
        const graph = await editable(tx, access, graphId);
        if (!graph.ok) return graph;
        const base = await baseOf(tx, access, graph.value);
        if (!base) return fail('conflict', 'This graph does not override another graph');
        const draft = await findDraft(tx, graphId);
        const current =
          draft?.definition ?? (await findNewestPublishedVersion(tx, graphId))?.definition;
        const definition = (mode === 'reset' ? base.definition : current) as GraphDef | undefined;
        if (!definition) return fail('conflict', 'Nothing to rebase');
        if (draft) await updateDraft(tx, draft.id, definition, base.id);
        else {
          await insertDraft(tx, {
            graphId,
            version: await nextVersion(tx, graphId),
            definition,
            baseVersionId: base.id,
            userId: access.userId
          });
        }
        await touchGraph(tx, graphId);
        return ok({ id: graphId });
      }),
    remove: async (access: AgencyAccess, graphId: string) => {
      const graph = await editable(db, access, graphId);
      if (!graph.ok) return graph;
      if (graph.value.overrides) {
        await setGraphActive(db, graphId, false);
        return ok({ id: graphId });
      }
      try {
        return (await deleteGraph(db, graphId)) ? ok({ id: graphId }) : notFound;
      } catch (err) {
        if (isForeignKeyViolation(err)) {
          return fail('conflict', 'Runs still use this graph, so it cannot be removed');
        }
        throw err;
      }
    },
    publish: (access: AgencyAccess, graphId: string) =>
      db.transaction().execute(async (tx) => {
        const graph = await editable(tx, access, graphId);
        if (!graph.ok) return graph;
        const draft = await findDraft(tx, graphId);
        if (!draft) return fail('conflict', 'Nothing to publish');
        const definition = draft.definition as GraphDef;
        const { issues, dependencies } = await check(tx, access, definition);
        if (issues.length) return fail('invalid', 'Fix the issues before publishing', { issues });
        const system = await findSystemGraph(tx, graph.value.key);
        const original = system && (await findNewestPublishedVersion(tx, system.id));
        if (original && original.contract !== contractOf(definition.signature)) {
          return fail(
            'invalid',
            'An override must keep the inputs, outputs and exits of the built-in graph it replaces'
          );
        }
        await publishVersion(tx, draft.id, dependencies);
        await touchGraph(tx, graphId);
        return ok({ version: draft.version });
      })
  };
};

export type GraphService = ReturnType<typeof createGraphService>;
