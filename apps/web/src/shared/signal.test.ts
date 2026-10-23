import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSignal } from './signal.ts';

describe('createSignal', () => {
  it('notifies current listeners until they unsubscribe', () => {
    const signal = createSignal();
    let calls = 0;
    const stop = signal.subscribe(() => calls++);
    signal.emit();
    stop();
    signal.emit();
    assert.equal(calls, 1);
  });
});
