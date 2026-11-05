import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { needsReseal, openSecret, parseKeyring, sealSecret } from './secrets.ts';

const newKey = () => randomBytes(32).toString('base64');

const ring = parseKeyring(newKey());

describe('secrets', () => {
  it('seals a secret with a fresh IV each time and opens it with the same key and context', () => {
    const a = sealSecret(ring, 'p@ss wörd', 'agency-1');
    const b = sealSecret(ring, 'p@ss wörd', 'agency-1');
    assert.notEqual(a, b);
    assert.ok(a.startsWith(`v1.${ring.current.id}.`) && !a.includes('p@ss'));
    assert.equal(openSecret(ring, a, 'agency-1'), 'p@ss wörd');
    assert.equal(openSecret(ring, sealSecret(ring, '', 'x'), 'x'), '');
  });

  it('refuses another key, another context, tampering and text that is not sealed', () => {
    const sealed = sealSecret(ring, 'secret', 'agency-1');
    const other = parseKeyring(newKey());
    assert.throws(() => openSecret(other, sealed, 'agency-1'), /not configured/);
    assert.throws(() => openSecret(ring, sealed, 'agency-2'));
    const [v, id, iv, tag, body] = sealed.split('.');
    const flipped = Buffer.from(body ?? '', 'base64');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    assert.throws(() =>
      openSecret(ring, [v, id, iv, tag, flipped.toString('base64')].join('.'), 'agency-1')
    );
    assert.throws(() => openSecret(ring, 'plain', 'agency-1'), /Not a sealed secret/);
    assert.throws(() => openSecret(ring, [v, iv, tag, body].join('.'), 'agency-1'));
  });

  it('opens secrets sealed with a previous key and says which ones to seal again', () => {
    const old = parseKeyring(newKey());
    const sealed = sealSecret(old, 'secret', 'agency-1');
    const rotated = parseKeyring(newKey(), [
      newKey(),
      Buffer.from(old.current.bytes).toString('base64')
    ]);
    assert.equal(openSecret(rotated, sealed, 'agency-1'), 'secret');
    assert.equal(needsReseal(rotated, sealed), true);
    assert.equal(needsReseal(rotated, sealSecret(rotated, 'secret', 'agency-1')), false);
    assert.equal(needsReseal(ring, sealed), false);
    assert.equal(needsReseal(rotated, 'plain'), false);
  });

  it('accepts only 32 byte base64 keys', () => {
    assert.throws(() => parseKeyring(randomBytes(16).toString('base64')), /32 bytes/);
    assert.throws(() => parseKeyring('not base64!'), /32 bytes/);
    assert.throws(() => parseKeyring(newKey(), ['short']), /32 bytes/);
  });
});
