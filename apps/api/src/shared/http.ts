import type { Context } from 'hono';
import * as v from 'valibot';

export const uuid = v.pipe(v.string(), v.uuid());

export const idParam = v.object({ id: uuid });

export const limitQuery = v.optional(
  v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(500)),
  '50'
);

export const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' && err !== null && 'code' in err && err.code === '23505';

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
