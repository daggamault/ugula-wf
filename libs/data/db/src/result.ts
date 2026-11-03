export type FailureCode =
  | 'invalid'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited';

export type Failure = {
  code: FailureCode;
  message: string;
  details?: Record<string, unknown>;
};

export type Result<T> = { ok: true; value: T } | { ok: false; failure: Failure };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const fail = (
  code: FailureCode,
  message: string,
  details?: Record<string, unknown>
): { ok: false; failure: Failure } => ({
  ok: false,
  failure: details ? { code, message, details } : { code, message }
});
