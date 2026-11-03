import type { LiveEvent } from '@ugula/live';
import type { Result } from './result.ts';

export type Announce = (tenantId: string, event: LiveEvent) => Promise<void>;

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
