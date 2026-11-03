import { busyRetryAfter } from '@ugula/inference';

export const deferralOf = (err: unknown): number | null =>
  err instanceof Error ? (busyRetryAfter(err) ?? deferralOf(err.cause)) : null;
