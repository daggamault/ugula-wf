import type { GraphRef, PublishedGraph, RunTableRef, TableKind } from '@ugula/db';
import {
  combineSources,
  createEngine,
  type Engine,
  type GraphDef,
  graphDefSchema,
  inlineTables,
  type Json,
  type NodeDef,
  type NodeRef,
  type ResolvedTable,
  refKey,
  stdGraphSource
} from '@ugula/graph';
import * as v from 'valibot';
import { deferralOf } from '../../shared/defer.ts';
import { isTransient } from './errors.ts';

type LoadedEngine = {
  engine: Engine;
  root: NodeRef;
};

export type EngineSource = (run: {
  versionId: string;
  graphs: GraphRef[];
  tables: RunTableRef[];
}) => Promise<LoadedEngine>;

type TableRow = { id: string; kind: TableKind; definition: unknown };

type EngineCacheDeps = {
  nodes: NodeDef[];
  loadDefinitions: (ids: string[]) => Promise<{ id: string; definition: unknown }[]>;
  loadTables: (ids: string[]) => Promise<TableRow[]>;
  max?: number;
};

export const bundleKey = (versionId: string, refs: GraphRef[], tables: RunTableRef[] = []) =>
  [
    versionId,
    ...refs.map((r) => `${r.key}@${r.version}=${r.id}`).sort(),
    ...tables.map((t) => `#${t.key}=${t.id}`).sort()
  ].join('|');

export const buildEngine = (
  nodes: NodeDef[],
  rows: PublishedGraph[],
  versionId: string,
  tables: ReadonlyMap<string, ResolvedTable> = new Map()
): LoadedEngine => {
  const root = rows.find((r) => r.id === versionId);
  if (!root) throw new Error(`Graph version ${versionId} not found`);
  const resolve = (key: string) => tables.get(key);
  const graphs = new Map<string, GraphDef>(
    rows.map((r) => [
      refKey({ type: r.key, version: r.version }),
      inlineTables(v.parse(graphDefSchema, r.definition), resolve)
    ])
  );
  return {
    engine: createEngine({
      nodes,
      graphs: combineSources(stdGraphSource, (ref) => graphs.get(refKey(ref))),
      isTransient,
      deferOf: deferralOf
    }),
    root: { type: root.key, version: root.version }
  };
};

export const createEngineCache = ({
  nodes,
  loadDefinitions,
  loadTables,
  max = 200
}: EngineCacheDeps): EngineSource => {
  const cache = new Map<string, Promise<LoadedEngine>>();
  const load = async (refs: GraphRef[], tables: RunTableRef[], versionId: string) => {
    const [defs, rows] = await Promise.all([
      loadDefinitions(refs.map((r) => r.id)),
      tables.length ? loadTables(tables.map((t) => t.id)) : []
    ]);
    const byId = new Map(defs.map((d) => [d.id, d.definition]));
    const tableById = new Map(rows.map((t) => [t.id, t]));
    const resolved = new Map(
      tables.flatMap((t) => {
        const row = tableById.get(t.id);
        return row
          ? [[t.key, { kind: row.kind, definition: row.definition as Json }] as const]
          : [];
      })
    );
    const graphs: PublishedGraph[] = refs.map((r) => ({
      ...r,
      definition: byId.get(r.id) ?? null
    }));
    return buildEngine(nodes, graphs, versionId, resolved);
  };
  return async ({ versionId, graphs: refs, tables }) => {
    const key = bundleKey(versionId, refs, tables);
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const loading = load(refs, tables, versionId);
    loading.catch(() => cache.delete(key));
    cache.set(key, loading);
    for (const key of cache.keys()) {
      if (cache.size <= max) break;
      cache.delete(key);
    }
    return loading;
  };
};
