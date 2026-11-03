import * as v from 'valibot';
import { defineNode, next, pin } from '../define.ts';
import { fail } from '../errors.ts';
import { isRecord, toText } from '../json.ts';
import type { Json, NodeDef } from '../types.ts';

export type HttpDeps = {
  fetch: typeof fetch;
  allowUrl?: (url: URL) => boolean | Promise<boolean>;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

const MAX_REDIRECTS = 5;

const requestConfig = v.object({
  method: v.optional(v.picklist(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']), 'GET'),
  failOnError: v.optional(v.boolean(), true)
});

const inCidr = (ip: number[], base: number[], bits: number) =>
  base.every((b, i) => {
    const take = Math.min(8, Math.max(0, bits - i * 8));
    const mask = (0xff << (8 - take)) & 0xff;
    return ((ip[i] ?? 0) & mask) === (b & mask);
  });

const PRIVATE_V4: [number[], number][] = [
  [[0, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[224, 0, 0, 0], 3]
];

const isPrivateV4 = (ip: number[]) => PRIVATE_V4.some(([base, bits]) => inCidr(ip, base, bits));

const parseV4 = (host: string) => {
  const parts = host.split('.').map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    ? parts
    : null;
};

const parseV6 = (host: string) => {
  const [head = '', tail] = host.split('::');
  const groups = (s: string) => (s ? s.split(':').map((g) => Number.parseInt(g, 16)) : []);
  const [a, b] = [groups(head), groups(tail ?? '')];
  const words = tail === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill(0), ...b];
  return words.flatMap((w) => [w >> 8, w & 0xff]);
};

const isPrivateV6 = (ip: number[]) => {
  const mapped = ip.slice(0, 10).every((x) => x === 0) && ip[10] === 0xff && ip[11] === 0xff;
  if (mapped || inCidr(ip, [0, 0x64, 0xff, 0x9b], 32)) return isPrivateV4(ip.slice(12));
  return (
    ip.slice(0, 15).every((x) => x === 0) ||
    inCidr(ip, [0xfc], 7) ||
    inCidr(ip, [0xfe, 0x80], 10) ||
    inCidr(ip, [0xff], 8)
  );
};

const denyPrivateNetworks = (url: URL) => {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[')) return !isPrivateV6(parseV6(host.slice(1, -1)));
  const v4 = parseV4(host);
  if (v4) return !isPrivateV4(v4);
  return (
    host.includes('.') &&
    !['.localhost', '.local', '.internal', '.localdomain'].some((s) => `.${host}`.endsWith(s))
  );
};

const readCapped = async (res: Response, max: number) => {
  if (Number(res.headers.get('content-length')) > max) fail(`HTTP response exceeds ${max} bytes`);
  const reader = res.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let [size, text] = [0, ''];
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    size += r.value.byteLength;
    if (size > max) {
      await reader.cancel();
      fail(`HTTP response exceeds ${max} bytes`);
    }
    text += decoder.decode(r.value, { stream: true });
  }
  return text + decoder.decode();
};

export const createHttpNodes = ({
  fetch,
  allowUrl = denyPrivateNetworks,
  timeoutMs = 30_000,
  maxResponseBytes = 5_000_000
}: HttpDeps): NodeDef[] => {
  const send = async (target: URL, init: RequestInit, signal: AbortSignal) => {
    let [url, req] = [target, init];
    for (let hops = 0; ; hops++) {
      if (!(await allowUrl(url))) fail(`HTTP request to ${url.origin} is not allowed`);
      const res = await fetch(url, { ...req, redirect: 'manual', signal });
      const location = res.headers.get('location');
      if (res.status < 300 || res.status > 399 || !location) return res;
      await res.body?.cancel();
      if (hops >= MAX_REDIRECTS) fail(`HTTP request redirected more than ${MAX_REDIRECTS} times`);
      const to = new URL(location, url);
      if (res.status !== 307 && res.status !== 308) req = { ...req, method: 'GET', body: null };
      if (to.origin !== url.origin) req = { ...req, headers: {} };
      url = to;
    }
  };

  return [
    defineNode<v.InferOutput<typeof requestConfig>>({
      type: 'std.http.request',
      version: 1,
      title: 'HTTP Request',
      category: 'Network',
      description: 'Calls a URL; JSON bodies are sent and parsed automatically.',
      config: requestConfig,
      effect: true,
      signature: {
        execIn: ['exec'],
        execOut: ['then'],
        inputs: [
          pin('url', 'string'),
          pin('headers', { object: {} }, { optional: true }),
          pin('body', 'any', { optional: true })
        ],
        outputs: [pin('status', 'integer'), pin('headers', { object: {} }), pin('body', 'any')]
      },
      run: async ({ read, config, ctx }) => {
        const url = URL.parse(String(await read('url'))) ?? fail('HTTP request needs a valid URL');
        const body = await read('body');
        const headers = Object.fromEntries(
          Object.entries((await read('headers')) ?? {}).map(([k, x]) => [k, toText(x)])
        );
        const timeout = AbortSignal.timeout(timeoutMs);
        const signal = ctx.signal ? AbortSignal.any([timeout, ctx.signal]) : timeout;
        const res = await send(
          url,
          {
            method: config.method,
            headers: {
              'idempotency-key': ctx.key,
              ...(body !== null && typeof body !== 'string'
                ? { 'content-type': 'application/json' }
                : {}),
              ...headers
            },
            ...(body === null
              ? {}
              : { body: typeof body === 'string' ? body : JSON.stringify(body) })
          },
          signal
        );
        const text = await readCapped(res, maxResponseBytes);
        const parsed: Json = res.headers.get('content-type')?.includes('json')
          ? (JSON.parse(text || 'null') as Json)
          : text;
        if (config.failOnError && !res.ok) {
          throw new Error(
            `HTTP ${res.status}: ${isRecord(parsed) ? JSON.stringify(parsed) : toText(parsed)}`.slice(
              0,
              500
            )
          );
        }
        return next('then', {
          status: res.status,
          headers: Object.fromEntries(res.headers.entries()),
          body: parsed
        });
      }
    })
  ];
};
