import type { Context } from 'hono';
import * as v from 'valibot';

export const uuid = v.pipe(v.string(), v.uuid());

export const idParam = v.object({ id: uuid });

const hasCode = (err: unknown, code: string) =>
  typeof err === 'object' && err !== null && 'code' in err && err.code === code;

export const isUniqueViolation = (err: unknown) => hasCode(err, '23505');

export const isForeignKeyViolation = (err: unknown) =>
  hasCode(err, '23503') || hasCode(err, '23001');

export const constraintOf = (err: unknown) =>
  typeof err === 'object' &&
  err !== null &&
  'constraint' in err &&
  typeof err.constraint === 'string'
    ? err.constraint
    : null;

type Issue = { message: string; path?: ReadonlyArray<unknown> };

type ValidationResult = { success: boolean; error?: ReadonlyArray<unknown> };

const segment = (p: unknown) =>
  String(typeof p === 'object' && p !== null && 'key' in p ? (p as { key: unknown }).key : p);

export const describeIssue = (issue: Issue) => {
  const field = (issue.path ?? []).map(segment).join('.');
  return field ? `${field}: ${issue.message}` : issue.message;
};

export const invalidRequest = (result: ValidationResult, c: Context) => {
  if (result.success) return undefined;
  const issues = (result.error ?? []) as Issue[];
  return c.json(
    {
      error: issues[0] ? describeIssue(issues[0]) : 'Invalid request',
      issues: issues.map(describeIssue)
    },
    400
  );
};
