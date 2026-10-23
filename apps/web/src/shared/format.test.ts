import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatCents, formatDateTime, formatDuration, parseDollars } from './format.ts';

describe('format', () => {
  it('formats timestamps and durations for display', () => {
    assert.equal(formatDateTime(null), '—');
    assert.ok(formatDateTime('2026-01-02T03:04:05Z').includes('2026'));
    assert.equal(formatDuration(0.2), '<1 ms');
    assert.equal(formatDuration(42.4), '42 ms');
    assert.equal(formatDuration(2500), '2.5 s');
    assert.equal(formatCents(114220), '$1,142.20');
    assert.equal(formatCents(0), '$0.00');
    assert.equal(parseDollars('950.5'), 95050);
    assert.equal(parseDollars('0.29'), 29);
    assert.equal(parseDollars(' '), null);
    assert.equal(parseDollars('-1'), null);
    assert.equal(parseDollars('abc'), null);
  });
});
