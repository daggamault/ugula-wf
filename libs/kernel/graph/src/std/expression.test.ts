import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { invokeNode } from '../testing.ts';
import { expressionConfig, expressionNode, identifierPins } from './expression.ts';

describe('expression node', () => {
  it('turns free names into inputs and evaluates the formula', async () => {
    const { signature, outputs } = await invokeNode(expressionNode, {
      config: { expression: 'price * qty + round(0.4)' },
      inputs: { price: 10, qty: 3 }
    });
    assert.deepEqual(
      signature.inputs.map((p) => p.name),
      ['price', 'qty']
    );
    assert.deepEqual(outputs, { result: 30 });
  });

  it('evaluates against the step clock', async () => {
    const { signature, outputs } = await invokeNode(expressionNode, {
      config: { expression: 'now()' },
      now: new Date('2026-01-02T03:04:05.000Z')
    });
    assert.deepEqual(signature.inputs, []);
    assert.deepEqual(outputs, { result: '2026-01-02T03:04:05.000Z' });
  });

  it('tolerates unparsable text when deriving pins but fails when run', async () => {
    assert.deepEqual(identifierPins(['max(', 'a + b'], ['b']), [
      { name: 'a', type: 'any', optional: true }
    ]);
    assert.deepEqual(
      identifierPins(['a + a', 'b * a']).map((p) => p.name),
      ['a', 'b']
    );
    await assert.rejects(
      () => invokeNode(expressionNode, { config: { expression: 'max(' } }),
      /Unexpected end/
    );
  });

  it('rejects broken formulas and unknown functions in its config', () => {
    const problem = (expression: string) => {
      const res = v.safeParse(expressionConfig, { expression });
      return res.success ? null : (res.issues[0]?.message ?? '');
    };
    assert.equal(problem('round(a, 2)'), null);
    assert.match(problem('a +* b') ?? '', /Unexpected "\*"/);
    assert.equal(problem('nosuchfn(1)'), 'Unknown function "nosuchfn"');
    assert.equal(problem('constructor(1)'), 'Unknown function "constructor"');
  });
});
