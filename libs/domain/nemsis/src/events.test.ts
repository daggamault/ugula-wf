import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NEMSIS_EVENTS, nemsisEvents } from './events.ts';

describe('nemsisEvents', () => {
  it('names the events workflows can start on', () => {
    assert.deepEqual(
      nemsisEvents.map((e) => e.type),
      Object.values(NEMSIS_EVENTS)
    );
  });

  it('gives every payload field a label and a description', () => {
    assert.deepEqual(
      nemsisEvents.flatMap((e) => e.payload.filter((p) => !p.label || !p.description)),
      []
    );
  });
});
