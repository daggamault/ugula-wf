import { type LookupAddress, type LookupAllOptions, lookup } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { isPublicAddress } from '@ugula/graph';
import { Agent } from 'undici';

export type Resolve = (
  host: string,
  options: LookupAllOptions,
  cb: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void
) => void;

const privateAddress = (host: string, address: string) =>
  Object.assign(new Error(`${host} resolves to the private address ${address}`), {
    code: 'EPRIVATEADDRESS'
  });

export const publicLookup =
  (resolve: Resolve = lookup): LookupFunction =>
  (host, options, cb) =>
    resolve(host, { ...options, all: true }, (err, addresses) => {
      if (err) return cb(err, '');
      const [first] = addresses;
      const denied = addresses.find((a) => !isPublicAddress(a.address));
      if (!first || denied) return cb(privateAddress(host, denied?.address ?? 'none'), '');
      if (options.all) return cb(null, addresses);
      cb(null, first.address, first.family);
    });

export const createPublicFetch = (inner: typeof fetch, resolve?: Resolve): typeof fetch => {
  const dispatcher = new Agent({ connect: { lookup: publicLookup(resolve) } });
  return (input, init) => inner(input, { ...init, dispatcher } as unknown as RequestInit);
};
