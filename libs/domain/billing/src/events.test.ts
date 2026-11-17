import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { billingEvents, EVENT_TYPES } from './events.ts';

describe('billingEvents', () => {
  it('names the events agencies can start workflows on', () => {
    assert.deepEqual(
      billingEvents.map((e) => e.type),
      Object.values(EVENT_TYPES)
    );
  });

  it('gives every payload field a label and a description', () => {
    assert.deepEqual(
      billingEvents.flatMap((e) => e.payload.filter((p) => !p.label || !p.description)),
      []
    );
  });
});
