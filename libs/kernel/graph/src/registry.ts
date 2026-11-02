import * as v from 'valibot';
import { type CompiledGraph, compileGraph, refKey } from './compile.ts';
import { coreNodes } from './core.ts';
import type { GraphDef, GraphSource, NodeDef, NodeInstance, NodeRef, Signature } from './types.ts';

export type Registry = {
  node: (ref: NodeRef) => NodeDef | undefined;
  graph: (ref: NodeRef) => CompiledGraph | undefined;
  config: (inst: NodeInstance) => unknown;
  signature: (inst: NodeInstance, graph: GraphDef) => Signature;
  nodes: () => NodeDef[];
};

export const isPure = (sig: Signature) => sig.execIn.length === 0 && sig.execOut.length === 0;

export const combineSources =
  (...sources: GraphSource[]): GraphSource =>
  (ref) => {
    for (const source of sources) {
      const def = source(ref);
      if (def) return def;
    }
    return undefined;
  };

export const createRegistry = (defs: NodeDef[], graphs: GraphSource): Registry => {
  const byKey = new Map<string, NodeDef>();
  for (const def of [...coreNodes, ...defs]) {
    const key = refKey(def);
    if (byKey.has(key)) throw new Error(`Duplicate node definition ${key}`);
    byKey.set(key, def);
  }
  const configs = new WeakMap<NodeInstance, unknown>();
  const signatures = new WeakMap<NodeInstance, Signature>();

  const node = (ref: NodeRef) => byKey.get(refKey(ref));
  const graph = (ref: NodeRef) => {
    if (byKey.has(refKey(ref))) return undefined;
    const def = graphs(ref);
    return def ? compileGraph(def) : undefined;
  };

  const config = (inst: NodeInstance) => {
    if (configs.has(inst)) return configs.get(inst);
    const def = node(inst);
    if (!def) throw new Error(`Unknown node type ${refKey(inst)}`);
    const parsed = def.config ? v.parse(def.config, inst.config ?? {}) : {};
    configs.set(inst, parsed);
    return parsed;
  };

  const signature = (inst: NodeInstance, owner: GraphDef) => {
    const hit = signatures.get(inst);
    if (hit) return hit;
    const def = node(inst);
    const sig = def
      ? typeof def.signature === 'function'
        ? def.signature(config(inst), { graph: owner })
        : def.signature
      : graph(inst)?.def.signature;
    if (!sig) throw new Error(`Unknown node type ${refKey(inst)}`);
    signatures.set(inst, sig);
    return sig;
  };

  return { node, graph, config, signature, nodes: () => [...byKey.values()] };
};
