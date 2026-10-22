import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseConfig } from './config.ts';

describe('sse parseConfig', () => {
  it('parses valid env and rejects missing vars', () => {
    const config = parseConfig({ SSE_PORT: '3002' });
    assert.equal(config.SSE_PORT, 3002);
    assert.throws(() => parseConfig({}));
  });
});
