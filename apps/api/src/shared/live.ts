import type { LiveEvent } from '@ugula/live';
import type { Result } from './result.ts';

export type Announce = (tenantId: string, event: LiveEvent) => Promise<void>;

/**
 * Awaits a write and, once it has committed, tells the tenant's clients what it changed. A lost
 * event only leaves clients stale until their next reload, so it never fails the request.
 */
export const announced = async <T>(
  announce: Announce,
  tenantId: string,
  write: Promise<Result<T>>,
  eventsOf: (value: T) => LiveEvent[]
) => {
  const res = await write;
  if (res.ok) {
    for (const event of eventsOf(res.value)) await announce(tenantId, event).catch(() => undefined);
  }
  return res;
};
