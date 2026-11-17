import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { describe, it } from 'node:test';
import { corsHeaders, sendJson } from './http.ts';

describe('sendJson', () => {
  it('writes status, json header, extra headers and serialized payload', () => {
    const calls: unknown[] = [];
    const res = {
      writeHead: (...args: unknown[]) => void calls.push(args),
      end: (chunk: string) => void calls.push(chunk)
    } as unknown as ServerResponse;
    sendJson(res, 401, { error: 'x' }, { vary: 'Origin' });
    assert.deepEqual(calls, [
      [401, { 'content-type': 'application/json', vary: 'Origin' }],
      '{"error":"x"}'
    ]);
  });
});

describe('corsHeaders', () => {
  it('allows credentialed requests only from configured origins', () => {
    assert.deepEqual(corsHeaders('http://b', ['http://a', 'http://b']), {
      'access-control-allow-origin': 'http://b',
      'access-control-allow-credentials': 'true',
      vary: 'Origin'
    });
    assert.deepEqual(corsHeaders('', ['']), {});
    assert.deepEqual(corsHeaders('http://evil', ['http://a']), {});
    assert.deepEqual(corsHeaders(undefined, ['http://a']), {});
  });
});
