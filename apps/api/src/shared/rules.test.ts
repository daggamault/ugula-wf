import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createStdNodes, ENTRY_TYPE, type GraphDef, RETURN_TYPE } from '@ugula/graph';
import { createRuleRunner } from './rules.ts';

const lookupRule = (table: string): GraphDef => ({
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
      config: { type: 'string', table: { key: table } }
    },
    { id: 'return', type: RETURN_TYPE, version: 1 }
  ],
  edges: [
    { from: 'entry', fromPin: 'code', to: 'lookup', toPin: 'key' },
    { from: 'lookup', fromPin: 'value', to: 'return', toPin: 'label' }
  ]
});

const now = new Date('2026-01-01T00:00:00.000Z');

const TABLES = [
  { key: 'acme.codes', kind: 'lookup', definition: { rows: [{ key: 'A', value: 'Alpha' }] } },
  { key: 'acme.other', kind: 'lookup', definition: { rows: [{ key: 'A', value: 'Other' }] } }
];

const runner = (bundle: unknown[]) => {
  const { db, queries } = createRecordingDb(({ sql }) =>
    sql.includes('with recursive bundle') ? bundle : TABLES
  );
  return { run: createRuleRunner(db, createStdNodes({ fetch })), queries };
};

describe('createRuleRunner', () => {
  it("runs the agency's effective rule with its tables inlined", async () => {
    const { run } = runner([
      { id: 'v-2', key: 'acme.rule', version: 2, definition: lookupRule('acme.codes') }
    ]);
    assert.deepEqual(await run('t-1', 'acme.rule', { code: 'A' }, now), { label: 'Alpha' });
  });

  it('loads the bundle for the agency and key, then the tables of its distinct versions', async () => {
    const { run, queries } = runner([
      { id: 'v-1', key: 'acme.rule', version: 1, definition: lookupRule('acme.other') },
      { id: 'v-1', key: 'acme.rule', version: 1, definition: lookupRule('acme.other') },
      { id: 'v-2', key: 'acme.rule', version: 2, definition: lookupRule('acme.codes') }
    ]);
    await run('t-1', 'acme.rule', { code: 'A' }, now);
    assert.equal(queries.length, 2);
    assert.deepEqual(queries[0]?.parameters, ['acme.rule', 'acme.rule', 't-1', 't-1']);
    assert.deepEqual(queries[1]?.parameters, [
      '$.nodes[*] ? (@.type == "std.table.decide" || @.type == "std.table.lookup" || @.type == "std.list.where").config.table.key',
      ['v-1', 'v-2'],
      't-1'
    ]);
  });

  it('runs the last bundled row for the key, the newest version', async () => {
    const { run } = runner([
      { id: 'v-1', key: 'acme.rule', version: 1, definition: lookupRule('acme.other') },
      { id: 'v-2', key: 'acme.rule', version: 2, definition: lookupRule('acme.codes') }
    ]);
    assert.deepEqual(await run('t-1', 'acme.rule', { code: 'A' }, now), { label: 'Alpha' });
  });

  it('says when the rule is not published, even if other rules are bundled', async () => {
    for (const bundle of [
      [],
      [{ id: 'v-3', key: 'acme.helper', version: 1, definition: lookupRule('acme.codes') }]
    ]) {
      const { run, queries } = runner(bundle);
      await assert.rejects(run('t-1', 'acme.rule', {}, now), {
        message: 'The rule acme.rule is not published'
      });
      assert.equal(queries.length, 1);
    }
  });

  it('rejects a bundled definition that is not a graph', async () => {
    const { run } = runner([{ id: 'v-2', key: 'acme.rule', version: 2, definition: {} }]);
    await assert.rejects(run('t-1', 'acme.rule', {}, now), { name: 'ValiError' });
  });
});
