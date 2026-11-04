import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { openSecret, parseSecretKey, sealSecret } from './secrets.ts';

const key = parseSecretKey(randomBytes(32).toString('base64'));

describe('secrets', () => {
  it('seals a secret with a fresh IV each time and opens it with the same key and context', () => {
    const a = sealSecret(key, 'p@ss wörd', 'agency-1');
    const b = sealSecret(key, 'p@ss wörd', 'agency-1');
    assert.notEqual(a, b);
    assert.ok(a.startsWith('v1.') && !a.includes('p@ss'));
    assert.equal(openSecret(key, a, 'agency-1'), 'p@ss wörd');
    assert.equal(openSecret(key, sealSecret(key, '', 'x'), 'x'), '');
  });

  it('refuses another key, another context, tampering and text that is not sealed', () => {
    const sealed = sealSecret(key, 'secret', 'agency-1');
    const other = parseSecretKey(randomBytes(32).toString('base64'));
    assert.throws(() => openSecret(other, sealed, 'agency-1'));
    assert.throws(() => openSecret(key, sealed, 'agency-2'));
    const [v, iv, tag, body] = sealed.split('.');
    const flipped = Buffer.from(body ?? '', 'base64');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    assert.throws(() =>
      openSecret(key, [v, iv, tag, flipped.toString('base64')].join('.'), 'agency-1')
    );
    assert.throws(() => openSecret(key, 'plain', 'agency-1'), /Not a sealed secret/);
  });

  it('accepts only a 32 byte base64 key', () => {
    assert.throws(() => parseSecretKey(randomBytes(16).toString('base64')), /32 bytes/);
    assert.throws(() => parseSecretKey('not base64!'), /32 bytes/);
  });
});
