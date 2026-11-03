import { compileGraph, ENTRY_TYPE, portKey, RETURN_TYPE, refKey } from './compile.ts';
import { messageOf } from './errors.ts';
import { freeIdentifiers } from './expr.ts';
import { isPure, type Registry } from './registry.ts';
import type { GraphDef, NodeInstance, Signature } from './types.ts';
import { checkValue, formatType, isAssignable } from './value-types.ts';

export type Issue = {
  node?: string;
  message: string;
};

const duplicates = (names: string[]) => names.filter((n, i) => names.indexOf(n) !== i);

const pinIssues = (sig: Signature) => [
  ...duplicates([...sig.execIn, ...sig.inputs.map((p) => p.name)]),
  ...duplicates([...sig.execOut, ...sig.outputs.map((p) => p.name)])
];

export const validateGraph = (def: GraphDef, registry: Registry): Issue[] => {
  const issues: Issue[] = [];
  const add = (message: string, node?: string) => {
    issues.push(node === undefined ? { message } : { node, message });
  };
  const g = compileGraph(def);
  const graphIsPure = isPure(def.signature);
  const varNames = new Set(def.variables.map((x) => x.name));

  for (const name of pinIssues(def.signature)) add(`Duplicate graph pin "${name}"`);
  for (const name of duplicates(def.variables.map((x) => x.name)))
    add(`Duplicate variable "${name}"`);
  for (const x of def.variables) {
    const err = checkValue(x.type, x.default);
    if (err) add(`Variable "${x.name}" default: ${err}`);
  }
  for (const id of duplicates(def.nodes.map((n) => n.id))) add(`Duplicate node id "${id}"`, id);
  if (def.nodes.filter((n) => n.type === ENTRY_TYPE).length > 1) {
    add('A graph can have only one Entry');
  }
  if (!g.entry && def.signature.execIn.length) add('Add an Entry node so execution can start');
  if (graphIsPure && g.returns.length !== 1) add('A pure graph needs exactly one Return');

  const sigs = new Map<string, Signature>();
  for (const node of def.nodes) {
    if (!registry.node(node) && !registry.graph(node)) {
      add(`Unknown node type ${refKey(node)}`, node.id);
      continue;
    }
    let sig: Signature;
    try {
      if (registry.node(node)) registry.config(node);
      sig = registry.signature(node, def);
    } catch (err) {
      add(`Invalid config: ${messageOf(err)}`, node.id);
      continue;
    }
    sigs.set(node.id, sig);
    if (graphIsPure && !isPure(sig) && node.type !== ENTRY_TYPE && node.type !== RETURN_TYPE) {
      add('Pure graphs can only contain pure nodes', node.id);
    }
    if (node.type === RETURN_TYPE) {
      const { pin } = registry.config(node) as { pin?: string };
      if (pin !== undefined && !def.signature.execOut.includes(pin)) {
        add(`Return pin "${pin}" is not an exec output of this graph`, node.id);
      }
    }
    for (const name of pinIssues(sig)) add(`Duplicate pin "${name}"`, node.id);
    for (const name of registry.node(node)?.variables?.(registry.config(node)) ?? []) {
      if (!varNames.has(name)) add(`Unknown variable "${name}"`, node.id);
    }
    checkBindings(node, sig, varNames, add);
  }

  for (const [i, e] of def.edges.entries()) {
    const fs = sigs.get(e.from);
    const ts = sigs.get(e.to);
    if (!g.nodes.has(e.from) || !g.nodes.has(e.to)) add(`Edge ${i} references a missing node`);
    if (!fs || !ts) continue;
    const fromData = fs.outputs.find((p) => p.name === e.fromPin);
    const toData = ts.inputs.find((p) => p.name === e.toPin);
    const fromExec = fs.execOut.includes(e.fromPin);
    const toExec = ts.execIn.includes(e.toPin);
    if (!fromData && !fromExec) add(`No output "${e.fromPin}"`, e.from);
    else if (!toData && !toExec) add(`No input "${e.toPin}"`, e.to);
    else if (fromExec !== toExec) add('Cannot connect exec and data pins', e.to);
    else if (fromData && toData && !isAssignable(fromData.type, toData.type)) {
      add(
        `"${e.toPin}" expects ${formatType(toData.type)} but got ${formatType(fromData.type)}`,
        e.to
      );
    }
  }

  for (const edges of g.out.values()) {
    const [first] = edges;
    if (first && edges.length > 1 && sigs.get(first.from)?.execOut.includes(first.fromPin)) {
      add(`Exec output "${first.fromPin}" can only connect once; use a Sequence`, first.from);
    }
  }
  for (const edges of g.in.values()) {
    const [first] = edges;
    if (
      first &&
      edges.length > 1 &&
      sigs.get(first.to)?.inputs.some((p) => p.name === first.toPin)
    ) {
      add(`Input "${first.toPin}" can only have one connection`, first.to);
    }
  }

  for (const node of def.nodes) {
    for (const spec of sigs.get(node.id)?.inputs ?? []) {
      const wired = g.in.has(portKey(node.id, spec.name));
      const bound = node.inputs?.[spec.name] !== undefined;
      if (wired && bound) add(`Input "${spec.name}" is both connected and set`, node.id);
      if (!wired && !bound && !spec.optional && spec.default === undefined) {
        add(`Input "${spec.label ?? spec.name}" is required`, node.id);
      }
    }
  }

  for (const id of pureCycle(def, sigs)) add('Pure nodes form a cycle', id);
  return issues;
};
const checkBindings = (
  node: NodeInstance,
  sig: Signature,
  varNames: ReadonlySet<string>,
  add: (message: string, node?: string) => void
) => {
  for (const [name, binding] of Object.entries(node.inputs ?? {})) {
    const spec = sig.inputs.find((p) => p.name === name);
    if (!spec) {
      add(`No input "${name}"`, node.id);
      continue;
    }
    if ('expr' in binding) {
      try {
        for (const id of freeIdentifiers(binding.expr)) {
          if (!varNames.has(id)) {
            add(`Expression for "${name}" uses unknown variable "${id}"`, node.id);
          }
        }
      } catch (err) {
        add(`Expression for "${name}": ${messageOf(err)}`, node.id);
      }
      continue;
    }
    const err = checkValue(spec.type, binding.value);
    if (err) add(`Value for "${name}": ${err}`, node.id);
  }
};

const pureCycle = (def: GraphDef, sigs: Map<string, Signature>) => {
  const entries = new Set(def.nodes.filter((n) => n.type === ENTRY_TYPE).map((n) => n.id));
  const pure = (id: string) => {
    const sig = sigs.get(id);
    return sig !== undefined && isPure(sig) && !entries.has(id);
  };
  const deps = new Map<string, string[]>();
  for (const e of def.edges) {
    if (pure(e.from) && pure(e.to)) deps.set(e.to, [...(deps.get(e.to) ?? []), e.from]);
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const cyclic = new Set<string>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 'done') return false;
    if (state.get(id) === 'visiting') return true;
    state.set(id, 'visiting');
    const hit = (deps.get(id) ?? []).some(visit);
    if (hit) cyclic.add(id);
    state.set(id, 'done');
    return hit;
  };
  for (const id of deps.keys()) visit(id);
  return [...cyclic];
};
