import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RETURN_TYPE } from './compile.ts';
import { pin, pureNode } from './define.ts';
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
      { message: 'Rule acme.rule@1 is not available' }
    );
    const stage = slotGraph({ ...passThrough.signature, execIn: ['exec'], execOut: ['then'] });
    await assert.rejects(
      runRule(
        { nodes, graphs: graphs({ 'acme.stage': stage }) },
        { type: 'acme.stage', version: 1 },
        {},
        now
      ),
      { message: 'acme.stage@1 is not a rule' }
    );
  });

  it('names the rule when one of its nodes fails', async () => {
    const boom = pureNode({
      type: 'acme.boom',
      title: 'Boom',
      category: 'Test',
      description: 'Always fails.',
      inputs: [],
      outputs: [pin('level', 'string')],
      compute: () => {
        throw new Error('no tariff');
      }
    });
    const failing: GraphDef = {
      ...passThrough,
      nodes: [
        { id: 'boom', type: 'acme.boom', version: 1 },
        { id: 'return', type: RETURN_TYPE, version: 1 }
      ],
      edges: [{ from: 'boom', fromPin: 'level', to: 'return', toPin: 'level' }]
    };
    await assert.rejects(
      runRule(
        { nodes: [...nodes, boom], graphs: graphs({ 'acme.rule': failing }) },
        { type: 'acme.rule', version: 1 },
        { level: 'ALS1' },
        now
      ),
      { message: 'Rule acme.rule@1 failed: no tariff' }
    );
  });
});
