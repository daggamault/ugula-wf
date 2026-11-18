import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '../testing.ts';
import type { Json, Values } from '../types.ts';
import { textNodes } from './text.ts';

const run = async (type: string, inputs: Values, config: Json = {}) => {
  const def = textNodes.find((d) => d.type === type);
  if (!def) throw new Error(type);
  return invokeNode(def, { inputs, config });
};

const out = async (type: string, inputs: Values) => (await run(type, inputs)).outputs;

describe('text nodes', () => {
  it('fills templates whose placeholders become inputs', async () => {
    const tpl = await run(
      'std.text.template',
      { claim: { id: 'C1' }, n: 2 },
      { template: 'Claim {claim.id} has { n } lines for {claim.payer} {missing}  today' }
    );
    assert.deepEqual(
      tpl.signature.inputs.map((p) => p.name),
      ['claim', 'n', 'missing']
    );
    assert.deepEqual(tpl.outputs, { text: 'Claim C1 has 2 lines for today' });
    const optional = { template: 'Payer[ (member {m.id})][, due {due}]' };
    assert.deepEqual((await run('std.text.template', { m: { id: 'M1' } }, optional)).outputs, {
      text: 'Payer (member M1)'
    });
    assert.deepEqual((await run('std.text.template', {}, optional)).outputs, { text: 'Payer' });
    assert.deepEqual(
      (await run('std.text.template', { m: { id: 0 }, due: false }, optional)).outputs,
      { text: 'Payer (member 0), due false' }
    );
    assert.deepEqual(
      (await run('std.text.template', {}, { template: 'plain {} {1a}' })).signature.inputs,
      []
    );
    await assert.rejects(
      () => run('std.text.template', {}, { template: 'Hi {constructor}' }),
      /reserved name/
    );
  });

  it('fills a pattern that arrives on a wire from a record of values', async () => {
    const fill = async (pattern: string, values?: Json) =>
      (await run('std.text.fill', values === undefined ? { pattern } : { pattern, values }))
        .outputs;
    assert.deepEqual(
      await fill('Claim {claim.id} for {name}[ (member {m})]  now', {
        claim: { id: 'C1' },
        name: 'Ann'
      }),
      { text: 'Claim C1 for Ann now' }
    );
    assert.deepEqual(await fill('[{a} ]{b}', { a: 'x', b: 2 }), { text: 'x 2' });
    assert.deepEqual(await fill('Hi {constructor}{toString}', {}), { text: 'Hi' });
    assert.deepEqual(await fill('Hi {name}'), { text: 'Hi' });
  });

  it('joins with a last separator and writes counts with their noun', async () => {
    const out = async (type: string, inputs: Values) => (await run(type, inputs)).outputs;
    const join = (items: Json[]) => out('std.text.join', { items, separator: ', ', last: ' and ' });
    assert.deepEqual(await join(['a', 'b', 'c']), { text: 'a, b and c' });
    assert.deepEqual(await join(['a', 'b']), { text: 'a and b' });
    assert.deepEqual(await join(['a']), { text: 'a' });
    assert.deepEqual(await join([]), { text: '' });
    for (const last of [null, '']) {
      assert.deepEqual(
        await out('std.text.join', { items: ['a', 'b', 'c'], separator: ', ', last }),
        {
          text: 'a, b, c'
        }
      );
    }
    assert.deepEqual(await out('std.text.count', { count: 1, singular: 'warning' }), {
      text: '1 warning'
    });
    assert.deepEqual(await out('std.text.count', { count: 3, singular: 'warning' }), {
      text: '3 warnings'
    });
    assert.deepEqual(
      await out('std.text.count', { count: 0, singular: 'person', plural: 'people' }),
      { text: '0 people' }
    );
    assert.deepEqual(
      await out('std.text.count', { count: 1, singular: 'person', plural: 'people' }),
      { text: '1 person' }
    );
    assert.deepEqual(await out('std.text.count', { count: 1.5, singular: 'mile' }), {
      text: '1.5 miles'
    });
    assert.deepEqual(await out('std.text.count', { singular: 'warning' }), { text: null });
    assert.deepEqual(await out('std.text.capitalize', { text: 'two claims' }), {
      result: 'Two claims'
    });
    assert.deepEqual(await out('std.text.capitalize', { text: '' }), { result: '' });
  });

  it('writes cents as dollars', async () => {
    assert.deepEqual((await run('std.text.money', { cents: 125050 })).outputs, {
      text: '$1,250.50'
    });
    assert.deepEqual((await run('std.text.money', {})).outputs, { text: null });
  });

  it('transforms and tests text', async () => {
    const out = async (type: string, inputs: Values, config: Json = {}) =>
      (await run(type, inputs, config)).outputs;
    assert.deepEqual(await out('std.text.upper', { text: 'ab' }), { result: 'AB' });
    assert.deepEqual(await out('std.text.lower', { text: 'AB' }), { result: 'ab' });
    assert.deepEqual(await out('std.text.trim', { text: ' a\n' }), { result: 'a' });
    assert.deepEqual(await out('std.text.length', { text: 'abc' }), { length: 3 });
    assert.deepEqual(await out('std.text.split', { text: 'a,b' }), { parts: ['a', 'b'] });
    assert.deepEqual(await out('std.text.split', { text: 'a b', separator: ' ' }), {
      parts: ['a', 'b']
    });
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
    assert.deepEqual(await out('std.text.substring', { text: 'hello', start: 1, end: -1 }), {
      result: 'ell'
    });
    assert.deepEqual(await out('std.text.replace', { text: 'a.b.c', find: '.' }), {
      result: 'abc'
    });
    assert.deepEqual(await out('std.text.replace', { text: 'ab', find: '', replacement: 'x' }), {
      result: 'ab'
    });
    assert.deepEqual(await out('std.text.starts-with', { text: 'A0427', part: 'A0' }), {
      result: true
    });
    assert.deepEqual(await out('std.text.ends-with', { text: 'A0427', part: 'A0' }), {
      result: false
    });
    assert.deepEqual(await out('std.text.contains', { text: 'A0427', part: '04' }), {
      result: true
    });
    assert.deepEqual(await out('std.text.contains', { text: 'A0427', part: 'a0' }), {
      result: false
    });
    assert.deepEqual(await out('std.text.starts-with', { text: 'A0427', part: '04' }), {
      result: false
    });
    assert.deepEqual(await out('std.text.ends-with', { text: 'A0427', part: '27' }), {
      result: true
    });
    assert.deepEqual(await out('std.text.starts-with', { text: null, part: 'Y' }), {
      result: false
    });
    assert.deepEqual(await out('std.text.join', {}), { text: '' });
    assert.deepEqual(await out('std.text.pad', { text: '1234', length: 2, fill: '0' }), {
      result: '1234'
    });
  });
});

describe('find phrases', () => {
  const narrative =
    'Pt denies chest pain. 18g IV established in L AC; no intubation. Patient was INTUBATED at the scene by fire.';

  it('finds whole-word mentions in any case and skips negated ones', async () => {
    assert.deepEqual(
      await out('std.text.find-phrases', {
        text: narrative,
        phrases: ['chest pain', 'IV', 'intubat', 'intubated', 'cardioversion']
      }),
      { found: true, matches: ['IV', 'intubated'] }
    );
  });

  it('counts negated mentions when asked', async () => {
    assert.deepEqual(
      await out('std.text.find-phrases', {
        text: narrative,
        phrases: ['chest pain'],
        countNegated: true
      }),
      { found: true, matches: ['chest pain'] }
    );
  });

  it('finds nothing in an empty text', async () => {
    assert.deepEqual(await out('std.text.find-phrases', { text: null, phrases: ['IV'] }), {
      found: false,
      matches: []
    });
  });
});

describe('find pattern', () => {
  it('gives the first match and its parts', async () => {
    assert.deepEqual(
      await out('std.text.find-pattern', {
        text: 'Transported 12.4 Loaded Miles to General.',
        pattern: '(\\d+(?:\\.\\d+)?)\\s*loaded miles'
      }),
      { found: true, match: '12.4 Loaded Miles', parts: ['12.4'] }
    );
  });

  it('finds nothing without a match or a text', async () => {
    const none = { found: false, match: null, parts: [] };
    assert.deepEqual(await out('std.text.find-pattern', { text: 'abc', pattern: '\\d' }), none);
    assert.deepEqual(await out('std.text.find-pattern', { text: null, pattern: '\\d' }), none);
  });

  it('refuses a pattern that is not valid', async () => {
    await assert.rejects(
      out('std.text.find-pattern', { text: 'abc', pattern: '(' }),
      /not a valid/
    );
  });
});

describe('template summary', () => {
  it('shows the pattern on one line', () => {
    const template = textNodes.find((n) => n.type === 'std.text.template');
    assert.equal(
      template?.summary?.({ template: 'Claim {id}\nfor {name}' }),
      'Claim {id} for {name}'
    );
    assert.equal(template?.summary?.({ template: '' }), null);
  });
});
