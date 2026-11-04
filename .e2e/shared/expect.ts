import assert from 'node:assert/strict';
import type { ClaimState } from './session.ts';

type ExpectedClaim = {
  tripType: string;
  level: string;
  emergency: boolean;
  lines: readonly (readonly [string, number])[];
  originDestination?: string;
  payers?: readonly string[];
  blocking?: readonly RegExp[];
  warnings?: readonly RegExp[];
};

const messages = (c: ClaimState, level: string) =>
  c.issues.filter((i) => i.level === level).map((i) => i.message);

const includes = (found: string[], expected: readonly RegExp[], what: string) => {
  for (const pattern of expected) {
    assert.ok(
      found.some((m) => pattern.test(m)),
      `expected a ${what} issue matching ${pattern}, found: ${found.join(' | ') || 'none'}`
    );
  }
};

export const expectClaim = (c: ClaimState, e: ExpectedClaim) => {
  assert.equal(c.claim.trip_type, e.tripType, 'trip type');
  assert.equal(c.claim.level, e.level, 'level of service');
  assert.equal(c.claim.emergency, e.emergency, 'emergency response');
  assert.deepEqual(
    c.claim.lines.map((l) => [l.code, Number(l.units)]),
    e.lines.map(([code, units]) => [code, units]),
    'charge lines'
  );
  if (e.originDestination !== undefined) {
    assert.equal(
      `${c.claim.origin_code ?? ''}${c.claim.destination_code ?? ''}`,
      e.originDestination,
      'origin/destination modifier'
    );
  }
  if (e.payers) {
    assert.deepEqual(
      c.claim.coverages.map((x) => x.payer),
      e.payers,
      'payers in order'
    );
  }
  const blocking = messages(c, 'blocking');
  includes(blocking, e.blocking ?? [], 'blocking');
  assert.equal(
    blocking.filter((m) => !(e.blocking ?? []).some((p) => p.test(m))).length,
    0,
    `unexpected blocking issues: ${blocking.join(' | ')}`
  );
  includes(messages(c, 'warning'), e.warnings ?? [], 'warning');
};

export const segmentsOf = (file: string, tag: string) =>
  file
    .split('~')
    .map((x) => x.trim())
    .filter((x) => x.startsWith(`${tag}*`));
