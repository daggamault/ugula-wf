import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '../testing.ts';
import type { Json, Values } from '../types.ts';
import { holds, tableNodes } from './tables.ts';

const run = async (type: string, inputs: Values, config: Json) => {
  const def = tableNodes.find((d) => d.type === type);
  if (!def) throw new Error(type);
  return invokeNode(def, { inputs, config });
};

const LEVELS = {
  inputs: [
    { name: 'care', type: 'string' },
    { name: 'ivDoses', type: 'integer' }
  ],
  outputs: [{ name: 'level', type: 'string' }],
  rules: [
    {
      label: 'Critical care',
      when: { care: { op: 'is', value: '4232009' } },
      set: { level: 'SCT' }
    },
    {
      label: 'Three IV doses',
      when: { ivDoses: { op: 'gte', value: 3 } },
      set: { level: 'ALS2' }
    },
    {
      label: 'ALS care',
      when: { care: { op: 'oneOf', value: ['4232003', '4232005'] } },
      set: { level: 'ALS1' }
    }
  ],
  otherwise: { level: 'BLS' }
};

describe('table nodes', () => {
  it('looks keys up with a fallback', async () => {
    const config = { rows: [{ key: '2223001', value: 'Emergent' }], fallback: 'Unknown' };
    assert.deepEqual((await run('std.table.lookup', { key: '2223001' }, config)).outputs, {
      value: 'Emergent',
      found: true
    });
    assert.deepEqual((await run('std.table.lookup', { key: 7 }, config)).outputs, {
      value: 'Unknown',
      found: false
    });
    const numbers = await run(
      'std.table.lookup',
      {},
      { type: 'integer', rows: [{ key: '1', value: 9 }] }
    );
    assert.deepEqual(numbers.signature.outputs[0], { name: 'value', type: 'integer' });
    assert.deepEqual(numbers.outputs, { value: null, found: false });
    assert.deepEqual(
      (
        await run(
          'std.table.lookup',
          { key: 1 },
          { type: 'integer', rows: [{ key: '1', value: 9 }] }
        )
      ).outputs,
      { value: 9, found: true }
    );
    await assert.rejects(() =>
      run('std.table.lookup', {}, { rows: [...config.rows, ...config.rows] })
    );
  });

  it('outputs the first matching rule, every rule that held, or otherwise', async () => {
    const hit = await run('std.table.decide', { care: '4232003', ivDoses: 3 }, LEVELS);
    assert.deepEqual(hit.outputs, {
      level: 'ALS2',
      rule: 'Three IV doses',
      rules: ['Three IV doses', 'ALS care'],
      matched: true
    });
    assert.deepEqual(
      hit.signature.inputs.map((p) => p.name),
      ['care', 'ivDoses']
    );
    assert.deepEqual(
      (await run('std.table.decide', { care: '4232001', ivDoses: null }, LEVELS)).outputs,
      { level: 'BLS', rule: null, rules: [], matched: false }
    );
    const { otherwise: _, ...always } = { ...LEVELS, rules: [{ label: 'Any', when: {} }] };
    assert.deepEqual((await run('std.table.decide', {}, always)).outputs, {
      level: null,
      rule: 'Any',
      rules: ['Any'],
      matched: true
    });
  });

  it('rejects rules on undeclared inputs or outputs', async () => {
    await assert.rejects(() =>
      run(
        'std.table.decide',
        {},
        { ...LEVELS, rules: [{ label: 'x', when: { nope: { op: 'empty' } } }] }
      )
    );
    await assert.rejects(() => run('std.table.decide', {}, { ...LEVELS, otherwise: { nope: 1 } }));
    await assert.rejects(
      () => run('std.table.decide', {}, { ...LEVELS, outputs: [{ name: 'rule', type: 'string' }] }),
      /do not name outputs rule/
    );
    await assert.rejects(
      () => run('std.table.decide', {}, { ...LEVELS, inputs: [], rules: [] }),
      /at least one input/
    );
  });

  it('tests conditions against scalars and lists', () => {
    assert.equal(holds({ op: 'is', value: 1 }, '1'), true);
    assert.equal(holds({ op: 'is', value: null }, ''), true);
    assert.equal(holds({ op: 'is' }, []), true);
    assert.equal(holds({ op: 'is', value: 'b' }, ['a', 'b']), true);
    assert.equal(holds({ op: 'isNot', value: 'b' }, ['a', 'b']), false);
    assert.equal(holds({ op: 'isNot', value: 'b' }, null), true);
    assert.equal(holds({ op: 'oneOf', value: 'a' }, 'a'), true);
    assert.equal(holds({ op: 'oneOf', value: ['a', 'b'] }, ['c', 'b']), true);
    assert.equal(holds({ op: 'notOneOf', value: ['a'] }, ['a']), false);
    assert.equal(holds({ op: 'gt', value: 2 }, '2.5'), true);
    assert.equal(holds({ op: 'gt', value: '9' }, '10'), true);
    assert.equal(holds({ op: 'gt', value: 2 }, 2), false);
    assert.equal(holds({ op: 'gte', value: 2 }, 2), true);
    assert.equal(holds({ op: 'gte', value: 5 }, [1, 7]), true);
    assert.equal(holds({ op: 'lt', value: 2 }, 'x'), false);
    assert.equal(holds({ op: 'lt', value: '2026-01-01' }, '2025-12-31'), true);
    assert.equal(holds({ op: 'lte', value: 1 }, null), false);
    assert.equal(holds({ op: 'empty' }, []), true);
    assert.equal(holds({ op: 'empty' }, 0), false);
    assert.equal(holds({ op: 'present' }, 0), true);
    assert.equal(holds({ op: 'present' }, ''), false);
  });
});

describe('startsWith', () => {
  it('matches any of several prefixes', () => {
    assert.equal(holds({ op: 'startsWith', value: ['Y92.0', 'Y92.1'] }, 'Y92.009'), true);
    assert.equal(holds({ op: 'startsWith', value: 'Y92.2' }, 'Y92.009'), false);
    assert.equal(holds({ op: 'startsWith', value: '' }, 'x'), false);
    assert.equal(holds({ op: 'startsWith', value: 'Y92' }, ['R10', 'Y92.0']), true);
  });
});
