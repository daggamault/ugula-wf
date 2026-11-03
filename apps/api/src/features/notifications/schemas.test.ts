import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { notificationSchema } from './schemas.ts';

describe('notificationSchema', () => {
  it('defaults messages to a success without a link', () => {
    assert.deepEqual(v.parse(notificationSchema, { title: ' Saved ' }), {
      intent: 'success',
      title: 'Saved',
      description: null,
      link: null
    });
  });

  it('keeps links inside the app and bounds the text', () => {
    const link = { label: 'Open', to: '/fees' };
    assert.deepEqual(
      v.parse(notificationSchema, { title: 'x', intent: 'danger', link }).link,
      link
    );
    for (const bad of [
      { title: 'x', link: { label: 'x', to: 'https://evil.test' } },
      { title: '' },
      { title: 'x'.repeat(201) },
      { title: 'x', description: 'x'.repeat(501) },
      { title: 'x', intent: 'loud' }
    ]) {
      assert.equal(v.safeParse(notificationSchema, bad).success, false);
    }
  });
});
