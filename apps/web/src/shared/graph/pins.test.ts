import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pinKindOf, toneOf } from './pins.ts';

describe('pin tones', () => {
  it('classify value types and give each a distinct color', () => {
    assert.equal(pinKindOf('exec'), 'exec');
    assert.equal(pinKindOf({ list: 'number' }), 'list');
    assert.equal(pinKindOf({ object: {} }), 'object');
    assert.ok(toneOf('number').dot.includes('emerald'));
    assert.ok(toneOf({ list: 'any' }).edge.includes('stroke-sky-500'));
    assert.notEqual(toneOf('string').dot, toneOf('integer').dot);
  });
});
