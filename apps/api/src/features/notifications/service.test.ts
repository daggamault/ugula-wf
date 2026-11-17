import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { recordAnnouncements } from '../../shared/testing.ts';
import { createNotificationService, toNotification } from './service.ts';

const row = {
  id: 'n1',
  intent: 'info' as const,
  title: 'New task',
  description: 'PCR-1',
  link_label: 'Open task',
  link_to: '/tasks/k1',
  created_at: new Date('2026-11-01T00:00:00Z'),
  read: false
};

describe('toNotification', () => {
  it('shapes rows with their link and read state', () => {
    assert.deepEqual(toNotification(row), {
      id: 'n1',
      intent: 'info',
      title: 'New task',
      description: 'PCR-1',
      action: { label: 'Open task', to: '/tasks/k1' },
      at: '2026-11-01T00:00:00.000Z',
      read: false
    });
    assert.equal(toNotification({ ...row, link_to: null }).action, null);
  });
});

describe('notification service', () => {
  it('counts unread messages and tells the agency about every change', async () => {
    const { db, queries } = createRecordingDb(() => [row, { ...row, id: 'n2', read: true }]);
    const { publish, events } = recordAnnouncements();
    const service = createNotificationService({ db, publish });
    assert.deepEqual(await service.list('t', 'u'), {
      ok: true,
      value: {
        items: [toNotification(row), toNotification({ ...row, id: 'n2', read: true })],
        unread: 1
      }
    });
    assert.deepEqual(queries[0]?.parameters.slice(0, 4), ['u', 't', 't', 'u']);
    assert.deepEqual(
      await service.create('t', 'u', {
        intent: 'success',
        title: 'Saved',
        description: '',
        link: null
      }),
      { ok: true, value: { status: 'ok' } }
    );
    assert.deepEqual(queries[1]?.parameters, ['t', 'u', 'success', 'Saved', null, null, null]);
    assert.deepEqual(await service.read('t', 'u'), { ok: true, value: { status: 'ok' } });
    assert.doesNotMatch(queries[2]?.sql ?? '', /"cleared_at" = now()/);
    assert.deepEqual(await service.clear('t', 'u'), { ok: true, value: { status: 'ok' } });
    assert.match(queries[3]?.sql ?? '', /"cleared_at" = now()/);
    assert.deepEqual(
      events,
      Array.from({ length: 3 }, () => ({
        agencyId: 't',
        event: { kind: 'notification', id: null }
      }))
    );
    await db.destroy();
  });
});
