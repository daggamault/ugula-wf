import { AsyncLocalStorage } from 'node:async_hooks';

export type RunContext = { runId: string; agencyId: string; signal: AbortSignal };

type Fetch = typeof fetch;

export const createRunScope = () => {
  const als = new AsyncLocalStorage<RunContext>();
  const current = () => als.getStore();
  return {
    within: <T>(ctx: RunContext, fn: () => Promise<T>) => als.run(ctx, fn),
    agencyOf: (runId: string) => {
      const ctx = current();
      return ctx?.runId === runId ? ctx.agencyId : undefined;
    },
    guard: <S extends object>(store: S): S =>
      Object.fromEntries(
        Object.entries(store).map(([name, fn]) => [
          name,
          typeof fn === 'function'
            ? (...args: unknown[]) => {
                current()?.signal.throwIfAborted();
                return fn(...args);
              }
            : fn
        ])
      ) as S,
    fetch:
      (inner: Fetch): Fetch =>
      (input, init) => {
        const lease = current()?.signal;
        if (!lease) return inner(input, init);
        const signal = init?.signal ? AbortSignal.any([init.signal, lease]) : lease;
        return inner(input, { ...init, signal });
      }
  };
};
