import assert from 'node:assert/strict';
import type { LookupAddress } from 'node:dns';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { createPublicFetch, publicLookup, type Resolve } from './public-fetch.ts';

const resolveTo =
  (...addresses: LookupAddress[]): Resolve =>
  (_host, _options, cb) =>
    cb(null, addresses);

const lookupOf = (resolve: Resolve, all: boolean) =>
  new Promise<{ err: Error | null; address: unknown; family: number | undefined }>((done) =>
    publicLookup(resolve)('api.example.test', { all }, (err, address, family) =>
      done({ err, address, family })
    )
  );

describe('public fetch', () => {
  it('passes through public addresses in the shape the socket asked for', async () => {
    const resolve = resolveTo({ address: '93.184.216.34', family: 4 });
    assert.deepEqual(await lookupOf(resolve, false), {
      err: null,
      address: '93.184.216.34',
      family: 4
    });
    assert.deepEqual((await lookupOf(resolve, true)).address, [
      { address: '93.184.216.34', family: 4 }
    ]);
  });

  it('refuses names that resolve to any private, loopback or link-local address', async () => {
    for (const address of ['169.254.169.254', '10.0.0.5', '127.0.0.1', '::1', '::ffff:10.0.0.1']) {
      const { err } = await lookupOf(
        resolveTo({ address: '93.184.216.34', family: 4 }, { address, family: 6 }),
        true
      );
      assert.equal(err?.message, `api.example.test resolves to the private address ${address}`);
    }
  });

  it('passes resolver errors through and refuses names that resolve to nothing', async () => {
    const failure = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    const failing: Resolve = (_host, _options, cb) => cb(failure, []);
    assert.deepEqual(await lookupOf(failing, false), {
      err: failure,
      address: '',
      family: undefined
    });
    const { err, address } = await lookupOf(resolveTo(), false);
    assert.equal(err?.message, 'api.example.test resolves to the private address none');
    assert.equal((err as NodeJS.ErrnoException | null)?.code, 'EPRIVATEADDRESS');
    assert.equal(address, '');
  });

  it('never connects when a public-looking name points at an internal server', async () => {
    const hits: string[] = [];
    const server = createServer((req, res) => {
      hits.push(String(req.url));
      res.end('secret');
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    try {
      const fetchPublic = createPublicFetch(fetch, resolveTo({ address: '127.0.0.1', family: 4 }));
      await assert.rejects(
        () => fetchPublic(`http://metadata.example.test:${port}/latest`),
        (err: Error) => /private address/.test(String(err.cause))
      );
      assert.deepEqual(hits, []);
    } finally {
      server.close();
    }
  });
});
