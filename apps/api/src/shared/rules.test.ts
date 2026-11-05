import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createStdNodes, ENTRY_TYPE, type GraphDef, RETURN_TYPE } from '@ugula/graph';
import { createRuleRunner } from './rules.ts';

const rule: GraphDef = {
  signature: {
    execIn: [],
    execOut: [],
    inputs: [{ name: 'code', type: 'string' }],
    outputs: [{ name: 'label', type: 'string' }]
  },
  variables: [],
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1 },
    {
      id: 'lookup',
      type: 'std.table.lookup',
      version: 1,
      config: { type: 'string', table: { key: 'acme.codes' } }
    },
    { id: 'return', type: RETURN_TYPE, version: 1 }
  ],
  edges: [
    { from: 'entry', fromPin: 'code', to: 'lookup', toPin: 'key' },
    { from: 'lookup', fromPin: 'value', to: 'return', toPin: 'label' }
  ]
};

const now = new Date('2026-01-01T00:00:00.000Z');

const runner = (bundle: unknown[]) => {
  const { db, queries } = createRecordingDb(({ sql }) =>
    sql.includes('with recursive bundle')
      ? bundle
      : [
          {
            key: 'acme.codes',
            kind: 'lookup',
            definition: { rows: [{ key: 'A', value: 'Alpha' }] }
          }
        ]
  );
  return { run: createRuleRunner(db, createStdNodes({ fetch })), queries };
};

describe('createRuleRunner', () => {
  it("runs the agency's effective rule with its tables inlined", async () => {
    const { run, queries } = runner([
      { id: 'v-2', key: 'acme.rule', version: 2, definition: rule }
    ]);
    assert.deepEqual(await run('t-1', 'acme.rule', { code: 'A' }, now), { label: 'Alpha' });
    assert.ok(queries[1]?.parameters.some((p) => Array.isArray(p) && p.includes('v-2')));
  });

  it('says when the rule is not published', async () => {
    const { run } = runner([]);
    await assert.rejects(run('t-1', 'acme.rule', {}, now), /is not published/);
  });
});
