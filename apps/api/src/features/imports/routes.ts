import { timingSafeEqual } from 'node:crypto';
import { sValidator } from '@hono/standard-validator';
import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AuthEnv } from '../../shared/auth.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { importFormSchema, listImportsQuery, sftpAuthSchema, sftpEventSchema } from './schemas.ts';
import type { ImportService } from './service.ts';

const FORM_OVERHEAD_BYTES = 64 * 1024;

export const createImportRoutes = (service: ImportService, maxBytes: number) =>
  new Hono<AuthEnv>()
    .get('/', sValidator('query', listImportsQuery, invalidRequest), async (c) =>
      respond(c, await service.list(c.get('session').tenantId, c.req.valid('query')))
    )
    .get('/reports/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.report(c.get('session').tenantId, c.req.valid('param').id))
    )
    .post(
      '/',
      bodyLimit({
        maxSize: maxBytes + FORM_OVERHEAD_BYTES,
        onError: (c) => c.json({ error: 'File too large' }, 413)
      }),
      sValidator('form', importFormSchema, invalidRequest),
      async (c) => {
        const { file, workflow } = c.req.valid('form');
        const { tenantId, userId } = c.get('session');
        return respond(
          c,
          await service.upload(tenantId, userId, workflow, {
            name: file.name,
            type: file.type,
            bytes: new Uint8Array(await file.arrayBuffer())
          }),
          201
        );
      }
    );

export const requireBearer =
  (secret: string): MiddlewareHandler =>
  async (c, next) => {
    const expected = Buffer.from(`Bearer ${secret}`);
    const given = Buffer.from(c.req.header('authorization') ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  };

export const createSftpRoutes = (service: ImportService, secret: string) =>
  new Hono()
    .use(requireBearer(secret))
    .post('/auth', sValidator('json', sftpAuthSchema, invalidRequest), async (c) => {
      const { username, password } = c.req.valid('json');
      return respond(c, await service.authenticateSftp(username, password));
    })
    .post('/upload', sValidator('json', sftpEventSchema, invalidRequest), async (c) =>
      respond(c, await service.receiveSftpEvent(c.req.valid('json')))
    );
