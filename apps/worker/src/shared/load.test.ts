import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createLoadGate,
  createProcessSampler,
  defaultHeapBytes,
  type LoadSample,
  megabytes,
  overloadOf
} from './load.ts';

const limits = { eventLoop: 0.9, heapBytes: megabytes(1000), rssBytes: megabytes(2000) };

const calm: LoadSample = { eventLoop: 0.2, heapBytes: megabytes(100), rssBytes: megabytes(300) };

describe('overloadOf', () => {
  it('names the first limit a sample is over', () => {
    assert.equal(overloadOf(calm, limits), null);
    assert.equal(overloadOf({ ...calm, eventLoop: 0.95 }, limits), 'event loop 95% over 90%');
    assert.equal(
      overloadOf({ ...calm, heapBytes: megabytes(1200) }, limits),
      'heap 1200 MB over 1000 MB'
    );
    assert.equal(
      overloadOf({ ...calm, rssBytes: megabytes(2500) }, limits),
      'memory 2500 MB over 2000 MB'
    );
    assert.equal(
      overloadOf({ ...calm, rssBytes: megabytes(9000) }, { ...limits, rssBytes: null }),
      null
    );
  });
});

describe('createLoadGate', () => {
  it('closes over a limit and reopens only once load drops below 90% of it', () => {
    const samples = [0.5, 0.95, 0.85, 0.8, 0.85].map((eventLoop) => ({ ...calm, eventLoop }));
    const gate = createLoadGate(() => samples.shift() ?? calm, limits);
    assert.deepEqual(
      [gate(), gate(), gate(), gate(), gate()].map((g) => g.open),
      [true, false, false, true, true]
    );
  });
});

describe('createProcessSampler', () => {
  it('measures event loop utilization between samples and current memory', () => {
    const sample = createProcessSampler()();
    assert.ok(sample.eventLoop >= 0 && sample.eventLoop <= 1);
    assert.ok(sample.heapBytes > 0 && sample.rssBytes >= sample.heapBytes);
    assert.ok(defaultHeapBytes() > megabytes(100));
  });
});
