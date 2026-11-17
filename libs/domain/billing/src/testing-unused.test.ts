import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { unused } from './testing-unused.ts';

describe('unused', () => {
  it('fails any call to a store a test does not expect, naming the store', async () => {
    await assert.rejects(unused('fee')(), { message: 'The fee store is not used here' });
  });
});
