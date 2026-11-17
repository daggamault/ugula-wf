import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { notificationSchema } from './schemas.ts';

const issues = (input: unknown) =>
  v.safeParse(notificationSchema, input).issues?.map((i) => i.message);

describe('notificationSchema', () => {
  it('trims the title and defaults messages to a success without a link', () => {
    assert.deepEqual(v.parse(notificationSchema, { title: ' Saved ' }), {
      intent: 'success',
      title: 'Saved',
      description: null,
      link: null
    });
  });

  it('keeps an intent, trimmed description and a link inside the app', () => {
    assert.deepEqual(
      v.parse(notificationSchema, {
        title: 'x',
        intent: 'danger',
        description: ' Why ',
        link: { label: ' Open ', to: '/fees?id=1' }
      }),
      {
        intent: 'danger',
        title: 'x',
        description: 'Why',
        link: { label: 'Open', to: '/fees?id=1' }
      }
    );
  });

  it('refuses links that leave the app', () => {
    for (const to of ['https://evil.test', '//evil.test', '/\\evil.test', 'fees']) {
      assert.deepEqual(issues({ title: 'x', link: { label: 'x', to } }), [
        'Links stay inside the app'
      ]);
    }
  });

  it('refuses blank or long text and unknown intents', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ title: ' ' }, 'Invalid length: Expected !0 but received 0'],
      [{ title: 'x'.repeat(201) }, 'Invalid length: Expected <=200 but received 201'],
      [
        { title: 'x', description: 'x'.repeat(501) },
        'Invalid length: Expected <=500 but received 501'
      ],
      [
        { title: 'x', link: { label: 'x'.repeat(61), to: '/' } },
        'Invalid length: Expected <=60 but received 61'
      ],
      [
        { title: 'x', link: { label: 'x', to: `/${'x'.repeat(300)}` } },
        'Invalid length: Expected <=300 but received 301'
      ],
      [
        { title: 'x', intent: 'loud' },
        'Invalid type: Expected ("primary" | "success" | "info" | "warning" | "danger") but received "loud"'
      ]
    ];
    for (const [input, message] of cases) assert.deepEqual(issues(input), [message], message);
  });
});
