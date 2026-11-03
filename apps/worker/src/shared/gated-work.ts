import type { Job } from 'pg-boss';
import type { LoadGate } from './load.ts';

export type SlotBoss = {
  work: <T>(
    name: string,
    options: { localConcurrency: number; batchSize: number; groupConcurrency?: number },
    handler: (jobs: Job<T>[]) => Promise<unknown>
  ) => Promise<string>;
  offWork: (name: string, options: { id: string; wait: boolean }) => Promise<void>;
};

type GatedWorkDeps<T> = {
  boss: SlotBoss;
  queue: string;
  concurrency: number;
  handler: (jobs: Job<T>[]) => Promise<unknown>;
  gate: LoadGate;
  report: (message: string) => void;
  groupConcurrency?: number;
  intervalMs?: number;
};

type Slot = { id: string | null; live: boolean };

export const createGatedWork = <T>({
  boss,
  queue,
  concurrency,
  handler,
  gate,
  report,
  groupConcurrency,
  intervalMs = 1_000
}: GatedWorkDeps<T>) => {
  const options = {
    localConcurrency: 1,
    batchSize: 1,
    ...(groupConcurrency ? { groupConcurrency } : {})
  };
  const slots = new Set<Slot>();
  let open = true;
  let ticking = false;
  let timer: NodeJS.Timeout | null = null;

  const spawn = async () => {
    const slot: Slot = { id: null, live: true };
    slots.add(slot);
    try {
      slot.id = await boss.work<T>(queue, options, handler);
    } catch (err) {
      slots.delete(slot);
      throw err;
    }
  };

  const drain = (slot: Slot) => {
    slot.live = false;
    if (!slot.id) return;
    boss
      .offWork(queue, { id: slot.id, wait: true })
      .catch((err: unknown) => report(`Stopping a ${queue} slot failed: ${String(err)}`))
      .finally(() => slots.delete(slot));
  };

  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const state = gate();
      if (state.open !== open) {
        open = state.open;
        report(
          open
            ? `Taking ${queue} jobs again`
            : `Not taking ${queue} jobs while ${state.reason ?? 'overloaded'}`
        );
      }
      if (open) while (slots.size < concurrency) await spawn();
      else for (const slot of slots) if (slot.live) drain(slot);
    } catch (err) {
      report(`Scheduling ${queue} slots failed: ${String(err)}`);
    } finally {
      ticking = false;
    }
  };

  return {
    start: async () => {
      await tick();
      timer = setInterval(tick, intervalMs);
      timer.unref();
    },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
    tick
  };
};
