import type { PublishedGraph } from '@ugula/db';
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

export type LoadedEngine = {
  engine: Engine;
  root: NodeRef;
};

export type EngineSource = (versionId: string) => Promise<LoadedEngine>;

export type EngineCacheDeps = {
  nodes: NodeDef[];
  loadBundle: (versionId: string) => Promise<PublishedGraph[]>;
  max?: number;
};

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
      graphs: combineSources(stdGraphSource, (ref) => graphs.get(refKey(ref)))
    }),
    root: { type: root.key, version: root.version }
  };
};

export const createEngineCache = ({
  nodes,
  loadBundle,
  max = 200
}: EngineCacheDeps): EngineSource => {
  const cache = new Map<string, Promise<LoadedEngine>>();
  return (versionId) => {
    const hit = cache.get(versionId);
    if (hit) {
      cache.delete(versionId);
      cache.set(versionId, hit);
      return hit;
    }
    const loading = loadBundle(versionId).then((rows) => buildEngine(nodes, rows, versionId));
    loading.catch(() => cache.delete(versionId));
    cache.set(versionId, loading);
    for (const key of cache.keys()) {
      if (cache.size <= max) break;
      cache.delete(key);
    }
    return loading;
  };
};
