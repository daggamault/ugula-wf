import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '../testing.ts';
import type { Json, Values } from '../types.ts';
import { templateExpressions, textNodes } from './text.ts';

const run = async (type: string, inputs: Values, config: Json = {}) => {
  const def = textNodes.find((d) => d.type === type);
  if (!def) throw new Error(type);
  return invokeNode(def, { inputs, config });
};

describe('text nodes', () => {
  it('fills templates whose placeholders become inputs', async () => {
    assert.deepEqual(templateExpressions('{{ a }} and {{b.c}}'), ['a', 'b.c']);
    const tpl = await run(
      'std.text.template',
      { claim: { id: 'C1' }, n: 2 },
      { template: 'Claim {{ claim.id }} has {{n}} lines' }
    );
    assert.deepEqual(
      tpl.signature.inputs.map((p) => p.name),
      ['claim', 'n']
    );
    assert.deepEqual(tpl.outputs, { text: 'Claim C1 has 2 lines' });
    await assert.rejects(
      () => run('std.text.template', {}, { template: 'Hi {{ name. }}' }),
      /Expected name/
    );
  });

  it('transforms and tests text', async () => {
    const out = async (type: string, inputs: Values, config: Json = {}) =>
      (await run(type, inputs, config)).outputs;
    assert.deepEqual(await out('std.text.upper', { text: 'ab' }), { result: 'AB' });
    assert.deepEqual(await out('std.text.length', { text: 'abc' }), { length: 3 });
    assert.deepEqual(await out('std.text.split', { text: 'a,b' }), { parts: ['a', 'b'] });
    assert.deepEqual(await out('std.text.join', { items: ['a', 1], separator: '-' }), {
      text: 'a-1'
    });
    assert.deepEqual(await out('std.text.pad', { text: '7', length: 3, fill: '0' }), {
      result: '007'
    });
    assert.deepEqual(await out('std.text.pad', { text: '7', length: 2 }, { side: 'end' }), {
      result: '7 '
    });
    await assert.rejects(
      () => out('std.text.pad', { text: '7', length: 100_001 }),
      /Pad: at most 100000 characters/
    );
    assert.deepEqual(await out('std.text.substring', { text: 'hello', start: 1 }), {
      result: 'ello'
    });
    assert.deepEqual(await out('std.text.replace', { text: 'a.b.c', find: '.' }), {
      result: 'abc'
    });
    assert.deepEqual(await out('std.text.starts-with', { text: 'A0427', part: 'A0' }), {
      result: true
    });
  });
});
