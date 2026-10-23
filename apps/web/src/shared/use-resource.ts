import { useCallback, useEffect, useRef, useState } from 'react';

export type Resource<T> = {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
};

export const useResource = <T>(key: string, load: () => Promise<T>, pollMs = 0): Resource<T> => {
  const loader = useRef(load);
  loader.current = load;
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<Omit<Resource<T>, 'reload'>>({
    data: undefined,
    error: undefined,
    loading: true
  });

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    loader
      .current()
      .then((data) => alive && setState({ data, error: undefined, loading: false }))
      .catch(
        (err: unknown) =>
          alive &&
          setState((s) => ({
            ...s,
            error: err instanceof Error ? err : new Error(String(err)),
            loading: false
          }))
      );
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
  return { ...state, reload };
};
