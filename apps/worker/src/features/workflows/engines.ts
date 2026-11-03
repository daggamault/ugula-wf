import type { GraphRef, PublishedGraph } from '@ugula/db';
import {
  combineSources,
  createEngine,
  type Engine,
  type GraphDef,
  graphDefSchema,
  type NodeDef,
  type NodeRef,
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
}) => Promise<LoadedEngine>;

type EngineCacheDeps = {
  nodes: NodeDef[];
  loadDefinitions: (ids: string[]) => Promise<{ id: string; definition: unknown }[]>;
  max?: number;
};

export const bundleKey = (versionId: string, refs: GraphRef[]) =>
  [versionId, ...refs.map((r) => `${r.key}@${r.version}=${r.id}`).sort()].join('|');

export const buildEngine = (
  nodes: NodeDef[],
  rows: PublishedGraph[],
  versionId: string
): LoadedEngine => {
  const root = rows.find((r) => r.id === versionId);
  if (!root) throw new Error(`Graph version ${versionId} not found`);
  const graphs = new Map<string, GraphDef>(
    rows.map((r) => [
      refKey({ type: r.key, version: r.version }),
      v.parse(graphDefSchema, r.definition)
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
  max = 200
}: EngineCacheDeps): EngineSource => {
  const cache = new Map<string, Promise<LoadedEngine>>();
  const load = async (refs: GraphRef[], versionId: string) => {
    const defs = new Map(
      (await loadDefinitions(refs.map((r) => r.id))).map((d) => [d.id, d.definition])
    );
    const rows: PublishedGraph[] = refs.map((r) => ({ ...r, definition: defs.get(r.id) ?? null }));
    return buildEngine(nodes, rows, versionId);
  };
  return async ({ versionId, graphs: refs }) => {
    const key = bundleKey(versionId, refs);
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const loading = load(refs, versionId);
    loading.catch(() => cache.delete(key));
    cache.set(key, loading);
    for (const key of cache.keys()) {
      if (cache.size <= max) break;
      cache.delete(key);
    }
    return loading;
  };
};
