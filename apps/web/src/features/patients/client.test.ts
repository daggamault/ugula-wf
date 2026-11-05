import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createPatientsClient, searchOf } from './client.ts';

describe('createPatientsClient', () => {
  it('searches by the fields given and opens one patient', async () => {
    const seen: string[] = [];
    const client = createPatientsClient(
      createApi('', async (url) => {
        seen.push(String(url));
        return new Response('{"patient":{"id":"p1"},"items":[]}', { status: 200 });
      })
    );
    await client.list(
      { lastName: ' Doe ', firstName: '', birthDate: '1958-04-12', number: '' },
      'page=1'
    );
    await client.list({ lastName: '', firstName: '', birthDate: '', number: '' }, 'page=2');
    await client.list(
      { lastName: '', firstName: '', birthDate: '', number: ' 20261105-0003 ' },
      'page=1'
    );
    assert.deepEqual(await client.find('p 1'), { id: 'p1' });
    assert.deepEqual(seen, [
      '/api/patients?lastName=Doe&birthDate=1958-04-12&page=1',
      '/api/patients?page=2',
      '/api/patients?number=20261105-0003&page=1',
      '/api/patients/p%201'
    ]);
    assert.deepEqual(searchOf(new URLSearchParams('lastName=doe&number=20261105-0003')), {
      lastName: 'doe',
      firstName: '',
      birthDate: '',
      number: '20261105-0003'
    });
  });
});

describe('searchOf', () => {
  it('reads blank fields when the URL has none', () => {
    assert.deepEqual(searchOf(new URLSearchParams()), {
      lastName: '',
      firstName: '',
      birthDate: '',
      number: ''
    });
  });
});
