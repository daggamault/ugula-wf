import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AuthEnv } from '../../shared/auth.ts';
import { FORM_OVERHEAD_BYTES } from '../../shared/files.ts';
import { idParam, invalidRequest } from '../../shared/http.ts';
import { respond } from '../../shared/result.ts';
import { listPayerFilesQuery, payerFileFormSchema } from './schemas.ts';
import type { PayerFileService } from './service.ts';

export const createPayerFileRoutes = (service: PayerFileService, maxBytes: number) =>
  new Hono<AuthEnv>()
    .get('/', sValidator('query', listPayerFilesQuery, invalidRequest), async (c) =>
      respond(c, await service.list(c.get('session').tenantId, c.req.valid('query')))
    )
    .get('/:id', sValidator('param', idParam, invalidRequest), async (c) =>
      respond(c, await service.find(c.get('session').tenantId, c.req.valid('param').id))
    )
    .get('/:id/file', sValidator('param', idParam, invalidRequest), async (c) => {
      const res = await service.download(c.get('session').tenantId, c.req.valid('param').id);
      if (!res.ok) return respond(c, res);
      return c.body(Uint8Array.from(res.value.bytes), 200, {
        'content-type': 'application/edi-x12',
        'content-disposition': `attachment; filename="${res.value.name.replace(/[^\w.-]/g, '_')}"`,
        'cache-control': 'private, no-store'
      });
    })
    .post(
      '/',
      bodyLimit({
        maxSize: maxBytes + FORM_OVERHEAD_BYTES,
        onError: (c) => c.json({ error: 'File too large' }, 413)
      }),
      sValidator('form', payerFileFormSchema, invalidRequest),
      async (c) => {
        const { file } = c.req.valid('form');
        const { tenantId, userId } = c.get('session');
        return respond(
          c,
          await service.upload(tenantId, userId, {
            name: file.name,
            type: file.type,
            bytes: new Uint8Array(await file.arrayBuffer())
          }),
          201
        );
      }
    );
