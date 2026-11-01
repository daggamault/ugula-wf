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
  });

  it('tests conditions against scalars and lists', () => {
    assert.equal(holds({ op: 'is', value: 1 }, '1'), true);
    assert.equal(holds({ op: 'is', value: null }, ''), true);
    assert.equal(holds({ op: 'oneOf', value: ['a', 'b'] }, ['c', 'b']), true);
    assert.equal(holds({ op: 'notOneOf', value: ['a'] }, ['a']), false);
    assert.equal(holds({ op: 'gt', value: 2 }, '2.5'), true);
    assert.equal(holds({ op: 'lt', value: '2026-01-01' }, '2025-12-31'), true);
    assert.equal(holds({ op: 'lte', value: 1 }, null), false);
    assert.equal(holds({ op: 'empty' }, []), true);
    assert.equal(holds({ op: 'present' }, 0), true);
  });
});

describe('startsWith', () => {
  it('matches any of several prefixes', () => {
    assert.equal(holds({ op: 'startsWith', value: ['Y92.0', 'Y92.1'] }, 'Y92.009'), true);
    assert.equal(holds({ op: 'startsWith', value: 'Y92.2' }, 'Y92.009'), false);
    assert.equal(holds({ op: 'startsWith', value: '' }, 'x'), false);
  });
});
