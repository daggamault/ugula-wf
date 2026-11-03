import { useCallback, useEffect, useRef, useState } from 'react';

export type Resource<T> = {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
};

type Loaded<T> = Omit<Resource<T>, 'reload' | 'loading'> & { key: string | null };

export const createLoadQueue = () => {
  let busy = false;
  let queued = false;
  return {
    start: () => {
      busy = true;
      queued = false;
    },
    request: () => {
      if (busy) queued = true;
      return !busy;
    },
    finish: () => {
      const again = queued;
      busy = false;
      queued = false;
      return again;
    }
  };
};

export const useResource = <T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  pollMs = 0
): Resource<T> => {
  const loader = useRef(load);
  loader.current = load;
  const [queue] = useState(createLoadQueue);
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<Loaded<T>>({ key: null, data: undefined, error: undefined });

  const reload = useCallback(() => {
    if (queue.request()) setTick((t) => t + 1);
  }, [queue]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    queue.start();
    setLoading(true);
    loader
      .current(signal)
      .then((data) => {
        if (!signal.aborted) setState({ key, data, error: undefined });
      })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        const error = err instanceof Error ? err : new Error(String(err));
        setState((s) => ({ key, data: s.key === key ? s.data : undefined, error }));
      })
      .finally(() => {
        if (signal.aborted) return;
        setLoading(false);
        if (queue.finish()) setTick((t) => t + 1);
      });
    return () => controller.abort();
  }, [key, tick, queue]);

  useEffect(() => {
    if (!pollMs) return;
    const timer = setInterval(reload, pollMs);
    return () => clearInterval(timer);
  }, [pollMs, reload]);

  const current = state.key === key;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    loading: loading || !current,
    reload
  };
};
