import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { demoGraphs } from './demo-graphs.ts';
import { assertValidGraphs, graphNodes } from './seed.ts';

describe('demo graphs', () => {
  it('validate against the std library in dependency order', () => {
    assert.doesNotThrow(() => assertValidGraphs(demoGraphs, graphNodes()));
    assert.deepEqual(
      demoGraphs.map((g) => g.key),
      ['demo.line-total', 'demo.process-item', 'demo.process-batch']
    );
  });
});
