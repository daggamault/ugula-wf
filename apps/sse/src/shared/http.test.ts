import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { describe, it } from 'node:test';
import { sendJson } from './http.ts';

describe('sendJson', () => {
  it('writes status, json header, and serialized payload', () => {
    let capturedStatus = 0;
    let capturedBody = '';
    const res = {
      writeHead: (status: number) => {
        capturedStatus = status;
      },
      end: (chunk: string) => {
        capturedBody = chunk;
      }
    } as unknown as ServerResponse;

    sendJson(res, 200, { status: 'ok' });
    assert.equal(capturedStatus, 200);
    assert.equal(capturedBody, '{"status":"ok"}');
  });
});
