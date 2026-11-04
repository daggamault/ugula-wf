import type { LiveEvent } from '@ugula/live';
import type { AgencyOf } from './tenancy.ts';

export type Publish = (agencyId: string, event: LiveEvent) => Promise<void>;

export type Announce = (runId: string, event: LiveEvent) => Promise<void>;

const COALESCE_MS = 250;

const keyOf = (agencyId: string, e: LiveEvent) =>
  [agencyId, e.kind, e.id ?? '', 'runId' in e ? (e.runId ?? '') : ''].join(':');

export const createAnnouncer =
  (agencyOf: AgencyOf, publish: Publish): Announce =>
  async (runId, event) => {
    const agencyId = await agencyOf(runId).catch(() => undefined);
    if (agencyId) await publish(agencyId, event).catch(() => undefined);
  };

export const coalescePublish = (publish: Publish, delayMs = COALESCE_MS) => {
  const pending = new Map<string, [string, LiveEvent]>();
  let timer: NodeJS.Timeout | null = null;
  const flush = async () => {
    timer = null;
    const batch = [...pending.values()];
    pending.clear();
    for (const [agencyId, event] of batch) await publish(agencyId, event).catch(() => undefined);
  };
  const queue: Publish = async (agencyId, event) => {
    pending.set(keyOf(agencyId, event), [agencyId, event]);
    if (!timer) {
      timer = setTimeout(flush, delayMs);
      timer.unref();
    }
  };
  return {
    publish: queue,
    flush: async () => {
      if (timer) clearTimeout(timer);
      await flush();
    }
  };
};
