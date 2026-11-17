export const EVENT_BATCH = 100;

export const EVENT_SWEEP_MS = 30_000;

type Dispatched = { events: number; started: number };

type DispatcherDeps = {
  dispatch: (limit: number) => Promise<Dispatched>;
  listen: (onNotify: () => void) => { stop: () => Promise<void> };
  report: (message: string) => void;
  sweepMs?: number;
};

export const startEventDispatcher = ({
  dispatch,
  listen,
  report,
  sweepMs = EVENT_SWEEP_MS
}: DispatcherDeps) => {
  let draining: Promise<void> | null = null;
  let again = false;
  let stopped = false;

  const drainAll = async () => {
    do {
      again = false;
      while (!stopped && (await dispatch(EVENT_BATCH)).events === EVENT_BATCH);
    } while (again && !stopped);
  };

  const wake = () => {
    if (stopped) return;
    if (draining) {
      again = true;
      return;
    }
    draining = drainAll()
      .catch((err: unknown) => report(`Dispatching events failed: ${String(err)}`))
      .finally(() => {
        draining = null;
      });
  };

  const listener = listen(wake);
  const sweep = setInterval(wake, sweepMs);
  wake();

  return {
    drained: () => draining ?? Promise.resolve(),
    stop: async () => {
      stopped = true;
      clearInterval(sweep);
      await listener.stop();
      await draining;
    }
  };
};
