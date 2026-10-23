import { useCallback, useEffect, useRef, useState } from 'react';

export type Resource<T> = {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
};

type Loaded<T> = Omit<Resource<T>, 'reload' | 'loading'> & { key: string | null };

export const useResource = <T>(key: string, load: () => Promise<T>, pollMs = 0): Resource<T> => {
  const loader = useRef(load);
  loader.current = load;
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<Loaded<T>>({ key: null, data: undefined, error: undefined });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loader
      .current()
      .then((data) => {
        if (alive) setState({ key, data, error: undefined });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const error = err instanceof Error ? err : new Error(String(err));
        setState((s) => ({ key, data: s.key === key ? s.data : undefined, error }));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [key, tick]);

  useEffect(() => {
    if (!pollMs) return;
    const timer = setInterval(() => setTick((t) => t + 1), pollMs);
    return () => clearInterval(timer);
  }, [pollMs]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  // Data loaded for another key (the previous page) must never stand in for this one.
  const current = state.key === key;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    loading: loading || !current,
    reload
  };
};
