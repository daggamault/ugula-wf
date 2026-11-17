import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { needsReseal, openSecret, parseKeyring, sealSecret } from './secrets.ts';

const keyOf = (fill: number) => Buffer.alloc(32, fill).toString('base64');

const ring = parseKeyring(keyOf(1));

describe('parseKeyring', () => {
  it('names each key by a short hash of its bytes and keeps previous keys', () => {
    const rotated = parseKeyring(` ${keyOf(1)} `, [keyOf(2), keyOf(3)]);
    assert.equal(rotated.current.id, 'cs1uhCLE');
    assert.deepEqual(rotated.current.bytes, Buffer.alloc(32, 1));
    assert.deepEqual([...rotated.keys.keys()], ['cs1uhCLE', 'dYd7tB05', 'ZIqlxXn7']);
    assert.deepEqual([...ring.keys.keys()], ['cs1uhCLE']);
  });

  it('accepts only 32 byte base64 keys', () => {
    assert.throws(() => parseKeyring(Buffer.alloc(16, 1).toString('base64')), /32 bytes/);
    assert.throws(() => parseKeyring(Buffer.alloc(33, 1).toString('base64')), /32 bytes/);
    assert.throws(() => parseKeyring('not base64!'), /32 bytes/);
    assert.throws(() => parseKeyring(''), /32 bytes/);
    assert.throws(() => parseKeyring(keyOf(1), ['short']), /32 bytes/);
  });
});

describe('sealSecret and openSecret', () => {
  it('seals a secret with a fresh IV each time and opens it with the same key and context', () => {
    const a = sealSecret(ring, 'p@ss wörd', 'agency-1');
    const b = sealSecret(ring, 'p@ss wörd', 'agency-1');
    assert.notEqual(a, b);
    assert.match(a, /^v1\.cs1uhCLE\.[\w+/=]{16}\.[\w+/=]{24}\.[\w+/=]+$/);
    assert.doesNotMatch(a, /p@ss/);
    assert.equal(openSecret(ring, a, 'agency-1'), 'p@ss wörd');
    assert.equal(openSecret(ring, b, 'agency-1'), 'p@ss wörd');
  });

  it('seals an empty secret', () => {
    const sealed = sealSecret(ring, '', 'x');
    assert.match(sealed, /\.$/);
    assert.equal(openSecret(ring, sealed, 'x'), '');
  });

  it('refuses a secret sealed with a key that is not configured', () => {
    const sealed = sealSecret(ring, 'secret', 'agency-1');
    assert.throws(
      () => openSecret(parseKeyring(keyOf(2)), sealed, 'agency-1'),
      /sealed with key cs1uhCLE, which is not configured/
    );
  });

  it('refuses another context and tampering', () => {
    const sealed = sealSecret(ring, 'secret', 'agency-1');
    assert.throws(() => openSecret(ring, sealed, 'agency-2'));
    const [v, id, iv, tag, body] = sealed.split('.');
    const flipped = Buffer.from(body ?? '', 'base64');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    assert.throws(() =>
      openSecret(ring, [v, id, iv, tag, flipped.toString('base64')].join('.'), 'agency-1')
    );
  });

  it('refuses text that is not a sealed secret', () => {
    const [v, id, iv, tag, body] = sealSecret(ring, 'secret', 'agency-1').split('.');
    for (const text of [
      'plain',
      '',
      [v, iv, tag, body].join('.'),
      ['v2', id, iv, tag, body].join('.'),
      [v, '', iv, tag, body].join('.'),
      [v, id, '', tag, body].join('.'),
      [v, id, iv, '', body].join('.'),
      [v, id, iv, tag, body, 'x'].join('.')
    ]) {
      assert.throws(() => openSecret(ring, text, 'agency-1'), /Not a sealed secret/, text);
    }
  });
});

describe('needsReseal', () => {
  it('flags secrets sealed with a configured previous key, and opens them', () => {
    const sealed = sealSecret(parseKeyring(keyOf(1)), 'secret', 'agency-1');
    const rotated = parseKeyring(keyOf(2), [keyOf(3), keyOf(1)]);
    assert.equal(openSecret(rotated, sealed, 'agency-1'), 'secret');
    assert.equal(needsReseal(rotated, sealed), true);
  });

  it('leaves secrets sealed with the current key, an unknown key, or not sealed at all', () => {
    const rotated = parseKeyring(keyOf(2), [keyOf(1)]);
    assert.equal(needsReseal(rotated, sealSecret(rotated, 'secret', 'agency-1')), false);
    assert.equal(
      needsReseal(rotated, sealSecret(parseKeyring(keyOf(3)), 'secret', 'agency-1')),
      false
    );
    assert.equal(needsReseal(rotated, 'plain'), false);
  });
});
