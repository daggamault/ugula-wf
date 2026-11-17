import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Api } from '../../shared/api.ts';
import { createPatientsClient, type PatientSearch, searchOf } from './client.ts';

const recordingApi = (reply: unknown) => {
  const calls: unknown[][] = [];
  const get = async (...args: unknown[]) => {
    calls.push(args);
    return reply;
  };
  return { client: createPatientsClient({ get } as unknown as Api), calls };
};

const BLANK: PatientSearch = { lastName: '', firstName: '', birthDate: '', number: '' };

describe('createPatientsClient', () => {
  it('lists patients by the trimmed fields given, in field order', async () => {
    const page = { items: [], total: 0, page: 1, pageSize: 25 };
    const { client, calls } = recordingApi(page);
    const signal = new AbortController().signal;
    assert.equal(
      await client.list(
        { lastName: ' Doe ', firstName: 'Jo Ann', birthDate: '1958-04-12', number: ' ' },
        'page=1',
        signal
      ),
      page
    );
    assert.deepEqual(calls, [
      ['/api/patients?lastName=Doe&firstName=Jo%20Ann&birthDate=1958-04-12&page=1', signal]
    ]);
  });

  it('lists every patient when no field is filled', async () => {
    const { client, calls } = recordingApi({ items: [] });
    await client.list(BLANK, 'page=2');
    assert.deepEqual(calls, [['/api/patients?page=2', undefined]]);
  });

  it('finds a patient by number alone', async () => {
    const { client, calls } = recordingApi({ items: [] });
    await client.list({ ...BLANK, number: ' 20261105-0003 ' }, 'page=1');
    assert.deepEqual(calls, [['/api/patients?number=20261105-0003&page=1', undefined]]);
  });

  it('opens one patient out of its envelope', async () => {
    const { client, calls } = recordingApi({ patient: { id: 'p 1' } });
    const signal = new AbortController().signal;
    assert.deepEqual(await client.find('p 1', signal), { id: 'p 1' });
    assert.deepEqual(calls, [['/api/patients/p%201', signal]]);
  });
});

describe('searchOf', () => {
  it('reads the search fields from the URL', () => {
    assert.deepEqual(
      searchOf(
        new URLSearchParams('lastName=doe&firstName=jo&birthDate=1958-04-12&number=20261105-0003')
      ),
      { lastName: 'doe', firstName: 'jo', birthDate: '1958-04-12', number: '20261105-0003' }
    );
  });

  it('reads blank fields when the URL has none', () => {
    assert.deepEqual(searchOf(new URLSearchParams('page=2')), BLANK);
  });
});
