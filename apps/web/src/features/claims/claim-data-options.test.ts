import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DESTINATION_OPTIONS,
  FACILITY_STAY_OPTIONS,
  MSP_QUESTIONS,
  ORIGIN_OPTIONS,
  TRANSPORT_REASON_OPTIONS
} from './claim-data-options.ts';

describe('claim data options', () => {
  it('offers every transport type but X as a pickup, and leaves both unset by default', () => {
    assert.deepEqual(ORIGIN_OPTIONS[0], { value: '', label: 'Not Set' });
    assert.equal(
      ORIGIN_OPTIONS.some((o) => o.value === 'X'),
      false
    );
    assert.equal(
      DESTINATION_OPTIONS.some((o) => o.value === 'X'),
      true
    );
    assert.ok(ORIGIN_OPTIONS.some((o) => o.label === 'S · Scene of an accident or acute event'));
  });

  it('labels coded choices and starts each with an unanswered option', () => {
    assert.deepEqual(TRANSPORT_REASON_OPTIONS[0], { value: '', label: 'Not Set' });
    assert.ok(TRANSPORT_REASON_OPTIONS.slice(1).every((o) => o.label.startsWith(`${o.value} · `)));
    assert.deepEqual(FACILITY_STAY_OPTIONS[0], { value: '', label: 'Unknown' });
    assert.ok(FACILITY_STAY_OPTIONS.some((o) => o.value === 'snf'));
  });

  it('asks the three Medicare Secondary Payer questions as flags', () => {
    assert.deepEqual(
      MSP_QUESTIONS.map((q) => q.key),
      ['mspEmployerPlan', 'mspEsrd', 'mspDisability']
    );
  });
});
