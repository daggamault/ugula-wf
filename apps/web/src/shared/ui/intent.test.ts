import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Intent } from './intent.ts';

describe('Intent', () => {
  it('names the five semantic intents every themed primitive supports', () => {
    const intents = ['primary', 'success', 'info', 'warning', 'danger'] satisfies Intent[];
    assert.equal(new Set<Intent>(intents).size, 5);
  });
});
