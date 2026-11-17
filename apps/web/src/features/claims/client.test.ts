import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { claimSearchOf, createClaimsClient } from './client.ts';

const recording = (reply: (url: string) => unknown = () => ({})) => {
  const seen: string[] = [];
  const client = createClaimsClient(
    createApi(
      'http://api.test',
      async (url, init = {}) => {
        seen.push(`${init.method} ${String(url)} ${String(init.body ?? '')}`);
        return new Response(JSON.stringify(reply(String(url))), { status: 200 });
      },
      undefined,
      () => null
    )
  );
  return { client, seen };
};

describe('createClaimsClient', () => {
  it('lists claims with the trimmed, non-empty search before the page query', async () => {
    const page = { items: [], total: 0, page: 2, pageSize: 25 };
    const { client, seen } = recording(() => page);
    assert.deepEqual(
      await client.list({}, 'page=2&pageSize=25&sort=total&dir=desc&status=needs_review'),
      page
    );
    await client.list(
      {
        firstName: '   ',
        lastName: ' doe ',
        number: '',
        birthDate: '1980-01-02',
        patientId: 'p1'
      },
      'page=1'
    );
    assert.deepEqual(seen, [
      'GET http://api.test/api/claims?page=2&pageSize=25&sort=total&dir=desc&status=needs_review ',
      'GET http://api.test/api/claims?lastName=doe&birthDate=1980-01-02&patientId=p1&page=1 '
    ]);
  });

  it('finds a claim', async () => {
    const { client, seen } = recording((url) => ({ url }));
    assert.deepEqual(await client.find('c/1'), { url: 'http://api.test/api/claims/c%2F1' });
    assert.deepEqual(seen, ['GET http://api.test/api/claims/c%2F1 ']);
  });
});

describe('claimSearchOf', () => {
  it('reads an empty search when the URL names none', () => {
    assert.deepEqual(claimSearchOf(new URLSearchParams('')), {
      firstName: '',
      lastName: '',
      birthDate: '',
      number: ''
    });
  });

  it('reads only the search fields from the URL, as typed', () => {
    assert.deepEqual(
      claimSearchOf(
        new URLSearchParams(
          'tab=search&firstName=Jo&lastName=doe&birthDate=1980-01-02&number=+42&status=paid'
        )
      ),
      { firstName: 'Jo', lastName: 'doe', birthDate: '1980-01-02', number: ' 42' }
    );
  });
});
