import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSignal } from './signal.ts';

describe('createSignal', () => {
  it('calls every subscribed listener on each emit', () => {
    const signal = createSignal();
    const calls: string[] = [];
    signal.subscribe(() => calls.push('a'));
    signal.subscribe(() => calls.push('b'));
    signal.emit();
    signal.emit();
    assert.deepEqual(calls, ['a', 'b', 'a', 'b']);
  });

  it('stops calling a listener once it unsubscribes and keeps the others', () => {
    const signal = createSignal();
    const calls: string[] = [];
    const stopA = signal.subscribe(() => calls.push('a'));
    signal.subscribe(() => calls.push('b'));
    stopA();
    signal.emit();
    assert.deepEqual(calls, ['b']);
  });

  it('calls a listener subscribed twice only once per emit', () => {
    const signal = createSignal();
    let calls = 0;
    const listener = () => {
      calls += 1;
    };
    signal.subscribe(listener);
    signal.subscribe(listener);
    signal.emit();
    assert.equal(calls, 1);
  });

  it('emits without listeners and tolerates unsubscribing twice', () => {
    const signal = createSignal();
    let calls = 0;
    const stop = signal.subscribe(() => {
      calls += 1;
    });
    stop();
    stop();
    signal.emit();
    assert.equal(calls, 0);
  });
});
