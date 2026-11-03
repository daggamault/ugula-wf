import type { LiveEvent } from '@ugula/live';
import type { TenantOf } from './tenancy.ts';

export type Publish = (tenantId: string, event: LiveEvent) => Promise<void>;

export type Announce = (runId: string, event: LiveEvent) => Promise<void>;

const COALESCE_MS = 250;

const keyOf = (tenantId: string, e: LiveEvent) =>
  [tenantId, e.kind, e.id ?? '', 'runId' in e ? (e.runId ?? '') : ''].join(':');

export const createAnnouncer =
  (tenantOf: TenantOf, publish: Publish): Announce =>
  async (runId, event) => {
    const tenantId = await tenantOf(runId).catch(() => undefined);
    if (tenantId) await publish(tenantId, event).catch(() => undefined);
  };

export const coalescePublish = (publish: Publish, delayMs = COALESCE_MS) => {
  const pending = new Map<string, [string, LiveEvent]>();
  let timer: NodeJS.Timeout | null = null;
  const flush = async () => {
    timer = null;
    const batch = [...pending.values()];
    pending.clear();
    for (const [tenantId, event] of batch) await publish(tenantId, event).catch(() => undefined);
  };
  const queue: Publish = async (tenantId, event) => {
    pending.set(keyOf(tenantId, event), [tenantId, event]);
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
