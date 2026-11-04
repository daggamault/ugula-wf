import { timingSafeEqual } from 'node:crypto';
import { sValidator } from '@hono/standard-validator';
import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AgencyEnv } from '../../shared/access.ts';
import { FORM_OVERHEAD_BYTES } from '../../shared/files.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import {
  importFormSchema,
  listImportsQuery,
  listReportsQuery,
  sftpAuthSchema,
  sftpEventSchema
} from './schemas.ts';
import type { ImportService } from './service.ts';

export const createImportRoutes = (service: ImportService, maxBytes: number) =>
  new Hono<AgencyEnv>()
    .get('/', sValidator('query', listImportsQuery, invalidRequest), async (c) =>
      respond(c, await service.list(c.get('access').agencyId, c.req.valid('query')))
    )
    .get('/reports/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.report(c.get('access').agencyId, c.req.valid('param').id))
    )
    .get('/reports/:id/xml', sValidator('param', idParam, invalidRequest), async (c) => {
      const res = await service.report(c.get('access').agencyId, c.req.valid('param').id);
      if (!res.ok) return respond(c, res);
      const name = res.value.report.pcr_number ?? res.value.report.id;
      return c.body(res.value.xml, 200, {
        'content-type': 'application/xml; charset=utf-8',
        'content-disposition': `attachment; filename="encounter-${name.replace(/[^\w.-]/g, '_')}.xml"`,
        'cache-control': 'private, no-store'
      });
    })
    .get('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.find(c.get('access').agencyId, c.req.valid('param').id))
    )
    .get(
      '/:id/reports',
      sValidator('param', idParam, invalidRequest),
      sValidator('query', listReportsQuery, invalidRequest),
      async (c) =>
        respond(
          c,
          await service.reports(
            c.get('access').agencyId,
            c.req.valid('param').id,
            c.req.valid('query')
          )
        )
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
        const { agencyId, userId } = c.get('access');
        return respond(
          c,
          await service.upload(agencyId, userId, workflow, {
            name: file.name,
            type: file.type,
            bytes: new Uint8Array(await file.arrayBuffer())
          }),
          201
        );
      }
    );

const requireBearer =
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
