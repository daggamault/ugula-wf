import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { describe, it } from 'node:test';
import { handleHealth } from './handler.ts';

describe('handleHealth', () => {
  it('writes a 200 JSON response with status ok', () => {
    const calls: unknown[][] = [];
    const res = {
      writeHead: (...args: unknown[]) => void calls.push(['writeHead', ...args]),
      end: (...args: unknown[]) => void calls.push(['end', ...args])
    } as unknown as ServerResponse;

    handleHealth(res);
    assert.deepEqual(calls, [
      ['writeHead', 200, { 'content-type': 'application/json' }],
      ['end', '{"status":"ok"}']
    ]);
  });
});
