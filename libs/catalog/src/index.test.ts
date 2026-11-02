import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRegistry, stdGraphSource } from '@ugula/graph';
import { createNodeCatalog } from './index.ts';

describe('createNodeCatalog', () => {
  it('registers the standard, NEMSIS, billing and model nodes without clashes', () => {
    const nodes = createNodeCatalog({ fetch });
    const registry = createRegistry(nodes, stdGraphSource);
    const types = registry.nodes().map((n) => n.type);
    for (const type of [
      'std.text.length',
      'nemsis.split',
      'billing.match-patient',
      'nemsis.pcr.break',
      'billing.claim.make'
    ]) {
      assert.ok(types.includes(type), type);
    }
    assert.equal(new Set(types).size, types.length);
  });
});
