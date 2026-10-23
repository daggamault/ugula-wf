import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type FailureCode = 'invalid' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict';

export type Failure = {
  code: FailureCode;
  message: string;
  details?: Record<string, unknown>;
};

export type Result<T> = { ok: true; value: T } | { ok: false; failure: Failure };

const statusOf: Record<FailureCode, ContentfulStatusCode> = {
  invalid: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409
};

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const fail = (
  code: FailureCode,
  message: string,
  details?: Record<string, unknown>
): { ok: false; failure: Failure } => ({
  ok: false,
  failure: details ? { code, message, details } : { code, message }
});

export const respond = <T>(c: Context, result: Result<T>, status: ContentfulStatusCode = 200) =>
  result.ok
    ? c.json(result.value as object, status)
    : c.json(
        { error: result.failure.message, ...result.failure.details },
        statusOf[result.failure.code]
      );
