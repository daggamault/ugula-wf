import type { FailureCode, Result } from '@ugula/db';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export { type Failure, type FailureCode, fail, ok, type Result } from '@ugula/db';

const statusOf: Record<FailureCode, ContentfulStatusCode> = {
  invalid: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429
};

export const respond = <T>(c: Context, result: Result<T>, status: ContentfulStatusCode = 200) =>
  result.ok
    ? c.json(result.value as object, status)
    : c.json(
        { error: result.failure.message, ...result.failure.details },
        statusOf[result.failure.code]
      );
