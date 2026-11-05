import {
  type Db,
  dependencyOf,
  findOrganizationGraphs,
  findPublishedGraphs,
  type GraphKind,
  type GraphRole
} from '@ugula/db';
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
  tableRefOf,
  tableRefs,
  validateGraph,
  workflowRefs
} from '@ugula/graph';
import type { AgencyAccess } from '../../shared/access.ts';
import { compareCopy, findBaseVersion, overrideCopy } from '../../shared/copies.ts';
import { isForeignKeyViolation, isUniqueViolation } from '../../shared/http.ts';
import { fail, ok } from '../../shared/result.ts';
import {
  canEditScope,
  type EditScope,
  findDraftOf,
  findEffectiveIn,
  findNewestPublished,
  findScoped,
  findSystem,
  findVersionOf,
  listEffective,
  lockOwner,
  nextVersionOf,
  ownerOf,
  type Scope,
  scopeIds,
  setActive,
  touch
} from '../../shared/scopes.ts';
import {
  deleteGraph,
  findGraph,
  findVisibleTableKeys,
  type GraphFilters,
  insertDraft,
  insertGraph,
  listDependents,
  listEffectiveGraphs,
  listPublishedNodes,
  listVersions,
  publishVersion,
  searchGraphs,
  updateDraft
} from './queries.ts';

type GraphServiceDeps = {
  db: Db;
  nodes: NodeDef[];
};

type NewGraph = {
  key: string;
  name: string;
  kind: GraphKind;
  role?: GraphRole | undefined;
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

export const roleFor = (kind: GraphKind, role: GraphRole | undefined): GraphRole =>
  kind === 'workflow' ? 'workflow' : role && role !== 'workflow' ? role : 'rule';

type MapGraph = {
  id: string;
  key: string;
  name: string;
  kind: GraphKind;
  role: GraphRole;
  scope: Scope;
  definition: GraphDef;
};

export const customizationMap = (graphs: readonly MapGraph[]) => {
  const keys = new Set(graphs.map((g) => g.key));
  return graphs.map(({ definition, ...g }) => ({
    ...g,
    children: [
      ...new Set(
        [...graphRefs(definition), ...workflowRefs(definition)]
          .map((r) => r.type)
          .filter((k) => k !== g.key && keys.has(k))
      )
    ],
    tables: tableRefs(definition)
  }));
};

export const createGraphService = ({ db, nodes }: GraphServiceDeps) => {
  const primitives = new Set(nodes.map(refKey));
  const check = async (
    tx: Db,
    access: AgencyAccess,
    def: GraphDef,
    scope: EditScope = 'agency'
  ) => {
    const refs = graphRefs(def)
      .filter((r) => !r.type.startsWith('std.') && !primitives.has(refKey(r)))
      .map((r) => ({ key: r.type, version: r.version }));
    const owner = ownerOf(access, scope);
    const composites =
      scope === 'organization'
        ? await findOrganizationGraphs(tx, access.organizationId, refs)
        : await findPublishedGraphs(tx, access.agencyId, refs);
    const byRef = new Map(
      composites.map((c) => [refKey({ type: c.key, version: c.version }), c.definition as GraphDef])
    );
    const registry = createRegistry(
      nodes,
      combineSources(stdGraphSource, (ref) => byRef.get(refKey(ref)))
    );
    const calls = workflowRefs(def).map((r) => dependencyOf({ key: r.type, version: r.version }));
    const keys = tableRefs(def);
    const known = new Set(await findVisibleTableKeys(tx, owner, keys));
    const tableIssues = def.nodes.flatMap((n) => {
      const key = tableRefOf(n)?.key;
      return key && !known.has(key) ? [{ node: n.id, message: `Unknown table ${key}` }] : [];
    });
    return {
      issues: [...validateGraph(def, registry), ...tableIssues],
      dependencies: [...new Set([...composites.map(dependencyOf), ...calls])]
    };
  };
  const editable = async (tx: Db, access: AgencyAccess, graphId: string) => {
    const graph = await findGraph(tx, scopeIds(access), graphId);
    if (!graph) return notFound;
    if (graph.scope === 'system') return fail('forbidden', 'Built-in graphs are read-only');
    if (!canEditScope(access, graph.scope, graph.role)) return forbidden(graph.scope);
    await lockOwner(tx, 'graphs', graphId);
    return ok({ ...graph, scope: graph.scope as EditScope });
  };
  const baseOf = (tx: Db, access: AgencyAccess, graph: { key: string; scope: Scope }) =>
    findBaseVersion(tx, 'graphs', access, graph);
  const bottomOf = async (tx: Db, access: AgencyAccess, graph: { key: string; scope: Scope }) => {
    const system = await findSystem(tx, 'graphs', graph.key);
    if (system || graph.scope !== 'agency') return system?.id;
    const org = await findScoped(tx, 'graphs', ownerOf(access, 'organization'), graph.key);
    return org?.is_active ? org.id : undefined;
  };
  return {
    search: async (access: AgencyAccess, filters: GraphFilters) =>
      ok(await searchGraphs(db, scopeIds(access), filters)),
    nodes: async (access: AgencyAccess) =>
      ok({ nodes: await listPublishedNodes(db, scopeIds(access)) }),
    map: async (access: AgencyAccess) => {
      const ids = scopeIds(access);
      const [graphs, tables] = await Promise.all([
        listEffectiveGraphs(db, ids),
        listEffective(db, 'data_tables', ids)
      ]);
      return ok({ graphs: customizationMap(graphs), tables });
    },
    find: async (access: AgencyAccess, id: string) => {
      const graph = await findGraph(db, scopeIds(access), id);
      if (!graph) return notFound;
      const effective = await findEffectiveIn(db, 'graphs', scopeIds(access), graph.key);
      return ok({
        graph: {
          ...graph,
          canEdit: canEditScope(access, graph.scope, graph.role),
          canOverride: {
            organization: graph.scope === 'system' && access.isOrganizationAdmin,
            agency: graph.scope !== 'agency' && canEditScope(access, 'agency', graph.role)
          },
          effectiveId: effective?.id ?? graph.id,
          effectiveScope: effective?.scope ?? graph.scope
        },
        versions: await listVersions(db, id)
      });
    },
    version: async (access: AgencyAccess, id: string, version: number) => {
      const found =
        (await findGraph(db, scopeIds(access), id)) &&
        (await findVersionOf(db, 'graphs', id, version));
      return found ? ok(found) : fail('not_found', 'Version not found');
    },
    compare: async (access: AgencyAccess, id: string) => {
      const graph = await findGraph(db, scopeIds(access), id);
      if (!graph) return notFound;
      const { copiedFrom, ...rest } = await compareCopy(db, 'graphs', access, graph);
      return ok({
        ...rest,
        copiedFrom: copiedFrom && {
          graphId: copiedFrom.ownerId,
          scope: copiedFrom.scope,
          version: copiedFrom.version,
          definition: copiedFrom.definition
        }
      });
    },
    validate: async (access: AgencyAccess, def: GraphDef) =>
      ok({ issues: (await check(db, access, def)).issues }),
    create: async (access: AgencyAccess, input: NewGraph) => {
      const role = roleFor(input.kind, input.role);
      if (!canEditScope(access, input.scope, role)) return forbidden(input.scope);
      if (await findSystem(db, 'graphs', input.key)) {
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
              role,
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
        const draft = await findDraftOf(tx, 'graphs', graphId);
        if (draft) await updateDraft(tx, draft.id, def);
        const version = draft
          ? draft.version
          : (
              await insertDraft(tx, {
                graphId,
                version: await nextVersionOf(tx, 'graphs', graphId),
                definition: def,
                baseVersionId: (await baseOf(tx, access, graph.value))?.id ?? null,
                userId: access.userId
              })
            ).version;
        await touch(tx, 'graphs', graphId);
        return ok({ version, issues: (await check(tx, access, def, graph.value.scope)).issues });
      }),
    override: (access: AgencyAccess, graphId: string, scope: EditScope) =>
      db.transaction().execute(async (tx) => {
        const graph = await findGraph(tx, scopeIds(access), graphId);
        if (!graph) return notFound;
        return overrideCopy(tx, 'graphs', access, graph, scope, {
          noun: 'graph',
          tier: graph.role,
          forbidden,
          insertCopy: (t, owner) =>
            insertGraph(t, {
              ...owner,
              key: graph.key,
              name: graph.name,
              kind: graph.kind,
              role: graph.role,
              description: graph.description
            }),
          insertDraft: (t, id, latest) =>
            insertDraft(t, {
              graphId: id,
              version: 1,
              definition: latest.definition as GraphDef,
              baseVersionId: latest.id,
              userId: access.userId
            })
        });
      }),
    rebase: (access: AgencyAccess, graphId: string, mode: 'keep' | 'reset') =>
      db.transaction().execute(async (tx) => {
        const graph = await editable(tx, access, graphId);
        if (!graph.ok) return graph;
        const base = await baseOf(tx, access, graph.value);
        if (!base) return fail('conflict', 'This graph does not override another graph');
        const draft = await findDraftOf(tx, 'graphs', graphId);
        const current =
          draft?.definition ?? (await findNewestPublished(tx, 'graphs', graphId))?.definition;
        const definition = (mode === 'reset' ? base.definition : current) as GraphDef | undefined;
        if (!definition) return fail('conflict', 'Nothing to rebase');
        if (draft) await updateDraft(tx, draft.id, definition, base.id);
        else {
          await insertDraft(tx, {
            graphId,
            version: await nextVersionOf(tx, 'graphs', graphId),
            definition,
            baseVersionId: base.id,
            userId: access.userId
          });
        }
        await touch(tx, 'graphs', graphId);
        return ok({ id: graphId });
      }),
    remove: async (access: AgencyAccess, graphId: string) => {
      try {
        return await db.transaction().execute(async (tx) => {
          const graph = await editable(tx, access, graphId);
          if (!graph.ok) return graph;
          if (graph.value.overrides) {
            await setActive(tx, 'graphs', graphId, false);
            return ok({ id: graphId });
          }
          const owner = { organizationId: access.organizationId, agencyId: graph.value.agency_id };
          const users = await listDependents(tx, owner, graph.value.key, graphId);
          if (users.length) {
            return fail(
              'conflict',
              `${users.map((u) => u.name).join(', ')} ${users.length === 1 ? 'uses' : 'use'} this graph, so it cannot be removed`
            );
          }
          return (await deleteGraph(tx, graphId)) ? ok({ id: graphId }) : notFound;
        });
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
        const draft = await findDraftOf(tx, 'graphs', graphId);
        if (!draft) return fail('conflict', 'Nothing to publish');
        const definition = draft.definition as GraphDef;
        const { issues, dependencies } = await check(tx, access, definition, graph.value.scope);
        if (issues.length) return fail('invalid', 'Fix the issues before publishing', { issues });
        const bottom = await bottomOf(tx, access, graph.value);
        const original = bottom && (await findNewestPublished(tx, 'graphs', bottom));
        if (original && original.contract !== contractOf(definition.signature)) {
          return fail(
            'invalid',
            'An override must keep the inputs, outputs and exits of the graph it replaces'
          );
        }
        await publishVersion(tx, draft.id, dependencies);
        await touch(tx, 'graphs', graphId);
        return ok({ version: draft.version });
      })
  };
};

export type GraphService = ReturnType<typeof createGraphService>;
