import type { Live } from './live.ts';

/** A live stream that never delivers events, for rendering pages in tests. */
export const idleLive: Live = {
  subscribe: () => () => undefined,
  status: () => 'online',
  onStatus: () => () => undefined,
  close: () => undefined
};
