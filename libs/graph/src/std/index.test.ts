import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createStdNodes } from './index.ts';

describe('createStdNodes', () => {
  it('provides a complete catalog with unique, documented node types', () => {
    const nodes = createStdNodes({ fetch });
    const keys = nodes.map((d) => `${d.type}@${d.version}`);
    assert.equal(new Set(keys).size, keys.length);
    for (const d of nodes) {
      assert.ok(d.type.startsWith('std.'), d.type);
      assert.ok(d.title && d.category && d.description, d.type);
    }
    const categories = new Set(nodes.map((d) => d.category));
    for (const c of [
      'Flow',
      'Variables',
      'Math',
      'Logic',
      'Text',
      'Lists',
      'Objects',
      'Time',
      'Human'
    ]) {
      assert.ok(categories.has(c), c);
    }
  });
});
