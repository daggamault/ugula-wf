import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BILLING_EVENTS, billingEvents } from './events.ts';

describe('billingEvents', () => {
  it('names the events agencies can start workflows on', () => {
    assert.deepEqual(
      billingEvents.map((e) => e.type),
      Object.values(BILLING_EVENTS)
    );
  });

  it('gives every payload field a label and a description', () => {
    assert.deepEqual(
      billingEvents.flatMap((e) => e.payload.filter((p) => !p.label || !p.description)),
      []
    );
  });
});
