import { ENTRY_TYPE, RETURN_TYPE } from './compile.ts';
import type { GraphDef, Signature } from './types.ts';
import { isAssignable } from './value-types.ts';

const passes = (signature: Signature) =>
  signature.outputs.every((o) => {
    const input = signature.inputs.find((i) => i.name === o.name);
    return input !== undefined && isAssignable(input.type, o.type);
  });

export const slotGraph = (signature: Signature): GraphDef => {
  if (!passes(signature)) {
    throw new Error('Every slot output needs an input of the same name and type');
  }
  if (signature.execIn.length > 1 || signature.execOut.length > 1) {
    throw new Error('A slot has at most one way in and one way out');
  }
  const [execIn] = signature.execIn;
  return {
    signature,
    variables: [],
    nodes: [
      { id: 'entry', type: ENTRY_TYPE, version: 1 },
      { id: 'return', type: RETURN_TYPE, version: 1 }
    ],
    edges: [
      ...(execIn ? [{ from: 'entry', fromPin: execIn, to: 'return', toPin: 'exec' }] : []),
      ...signature.outputs.map((o) => ({
        from: 'entry',
        fromPin: o.name,
        to: 'return',
        toPin: o.name
      }))
    ]
  };
};

export const isPassThrough = (def: GraphDef) => {
  const entry = def.nodes.find((n) => n.type === ENTRY_TYPE);
  const returns = def.nodes.filter((n) => n.type === RETURN_TYPE);
  const [ret] = returns;
  if (!entry || !ret || returns.length !== 1 || def.nodes.length !== 2) return false;
  if (!passes(def.signature)) return false;
  return def.signature.outputs.every((o) =>
    def.edges.some(
      (e) => e.from === entry.id && e.fromPin === o.name && e.to === ret.id && e.toPin === o.name
    )
  );
};
