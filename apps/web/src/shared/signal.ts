export type Signal = {
  emit: () => void;
  subscribe: (listener: () => void) => () => void;
};

export const createSignal = (): Signal => {
  const listeners = new Set<() => void>();
  return {
    emit: () => {
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    }
  };
};
