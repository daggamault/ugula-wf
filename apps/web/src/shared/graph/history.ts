import type { GraphDef } from '@ugula/graph';

export type History = {
  past: readonly GraphDef[];
  future: readonly GraphDef[];
  at: number;
};

export const HISTORY_LIMIT = 100;

export const COALESCE_MS = 600;

export const emptyHistory: History = { past: [], future: [], at: 0 };

export const recorded = (h: History, before: GraphDef, now: number): History =>
  h.past.length && now - h.at < COALESCE_MS
    ? { past: h.past, future: [], at: now }
    : { past: [...h.past, before].slice(-HISTORY_LIMIT), future: [], at: now };

export const undone = (h: History, current: GraphDef) => {
  const def = h.past.at(-1);
  return def
    ? { def, history: { past: h.past.slice(0, -1), future: [current, ...h.future], at: 0 } }
    : null;
};

export const redone = (h: History, current: GraphDef) => {
  const [def, ...future] = h.future;
  return def ? { def, history: { past: [...h.past, current], future, at: 0 } } : null;
};
