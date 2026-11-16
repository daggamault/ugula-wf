import type { LiveEvent } from '@ugula/live';
import type { Result } from './result.ts';

export type Publish = (agencyId: string, event: LiveEvent) => Promise<void>;

export const publishAfter = async <T>(
  publish: Publish,
  agencyId: string,
  write: Promise<Result<T>>,
  eventsOf: (value: T) => LiveEvent[]
) => {
  const res = await write;
  if (res.ok) {
    for (const event of eventsOf(res.value)) await publish(agencyId, event).catch(() => undefined);
  }
  return res;
};
