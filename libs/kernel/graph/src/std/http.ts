import * as v from 'valibot';
import { defineNode, next, pin } from '../define.ts';
import { isRecord, toText } from '../json.ts';
import type { Json, NodeDef } from '../types.ts';

export type HttpDeps = {
  fetch: typeof fetch;
};

const requestConfig = v.object({
  method: v.optional(v.picklist(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']), 'GET'),
  failOnError: v.optional(v.boolean(), true)
});

export const createHttpNodes = ({ fetch }: HttpDeps): NodeDef[] => [
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
      const body = await read('body');
      const headers = Object.fromEntries(
        Object.entries((await read('headers')) ?? {}).map(([k, x]) => [k, toText(x)])
      );
      const res = await fetch(String(await read('url')), {
        method: config.method,
        headers: {
          'idempotency-key': ctx.key,
          ...(body !== null && typeof body !== 'string'
            ? { 'content-type': 'application/json' }
            : {}),
          ...headers
        },
        ...(body === null ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) })
      });
      const text = await res.text();
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
