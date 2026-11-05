import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pin } from './define.ts';
import { combineSources } from './registry.ts';
import { ruleHost, runRule } from './rules.ts';
import { slotGraph } from './slot.ts';
import { stdGraphSource } from './std/composites.ts';
import { createStdNodes } from './std/index.ts';
import type { GraphDef } from './types.ts';

const nodes = createStdNodes({ fetch });

const now = new Date('2026-01-01T00:00:00.000Z');

const passThrough = slotGraph({
  execIn: [],
  execOut: [],
  inputs: [pin('level', 'string')],
  outputs: [pin('level', 'string')]
});

const graphs = (defs: Record<string, GraphDef>) =>
  combineSources(stdGraphSource, (ref) => defs[ref.type]);

describe('runRule', () => {
  it('wires a host that hands the inputs to the rule and returns its outputs', () => {
    const host = ruleHost({ type: 'acme.rule', version: 2 }, passThrough.signature);
    assert.deepEqual(host.signature.execIn, ['exec']);
    assert.deepEqual(
      host.edges.map((e) => `${e.from}.${e.fromPin}>${e.to}.${e.toPin}`),
      ['entry.exec>return.exec', 'entry.level>rule.level', 'rule.level>return.level']
    );
    assert.deepEqual(host.nodes[1], { id: 'rule', type: 'acme.rule', version: 2 });
  });

  it('evaluates a pure graph and returns its outputs', async () => {
    const outputs = await runRule(
      { nodes, graphs: graphs({ 'acme.rule': passThrough }) },
      { type: 'acme.rule', version: 1 },
      { level: 'ALS1' },
      now
    );
    assert.deepEqual(outputs, { level: 'ALS1' });
  });

  it('refuses graphs that are missing or have exec pins', async () => {
    await assert.rejects(
      runRule({ nodes, graphs: graphs({}) }, { type: 'acme.rule', version: 1 }, {}, now),
      /not available/
    );
    const stage = slotGraph({ ...passThrough.signature, execIn: ['exec'], execOut: ['then'] });
    await assert.rejects(
      runRule(
        { nodes, graphs: graphs({ 'acme.stage': stage }) },
        { type: 'acme.stage', version: 1 },
        {},
        now
      ),
      /is not a rule/
    );
  });
});
