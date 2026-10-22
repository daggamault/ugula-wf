import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { describe, it } from 'node:test';
import { handleHealth } from './handler.ts';

describe('handleHealth', () => {
  it('writes 200 status ok json response', () => {
    let status = 0;
    let body = '';
    const res = {
      writeHead: (code: number) => {
        status = code;
      },
      end: (payload: string) => {
        body = payload;
      }
    } as unknown as ServerResponse;

    handleHealth(res);
    assert.equal(status, 200);
    assert.equal(body, '{"status":"ok"}');
  });
});
