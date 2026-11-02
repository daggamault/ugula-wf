import { fail } from './errors.ts';
import type { Json, NodeResult, PinSpec, Signature, Values } from './types.ts';
import { checkValue } from './value-types.ts';

export const checkInput = (owner: string, spec: PinSpec, value: Json): Json => {
  const name = spec.label ?? spec.name;
  if (value === null) {
    return spec.optional ? null : fail(`Input "${name}" of "${owner}" is required`);
  }
  const err = checkValue(spec.type, value);
  return err ? fail(`Input "${name}" of "${owner}": ${err}`) : value;
};

export const checkOutputs = (owner: string, sig: Signature, outputs: Values) => {
  for (const [name, value] of Object.entries(outputs)) {
    const spec =
      sig.outputs.find((p) => p.name === name) ??
      fail(`"${owner}" produced unknown output "${name}"`);
    const err = checkValue(spec.type, value);
    if (err) fail(`Output "${name}" of "${owner}": ${err}`);
  }
};

export const checkExit = (owner: string, sig: Signature, res: NodeResult) => {
  if (res.type !== 'suspend' && res.pin !== null && !sig.execOut.includes(res.pin)) {
    fail(`"${owner}" fired unknown exec output "${res.pin}"`);
  }
};
