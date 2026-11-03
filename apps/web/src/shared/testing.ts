import { createNodeCatalog } from '@ugula/catalog';
import type { Live } from './live.ts';

export const idleLive: Live = {
  subscribe: () => () => undefined,
  status: () => 'online',
  onStatus: () => () => undefined,
  close: () => undefined
};

export const testNodes = createNodeCatalog({
  fetch: () => Promise.reject(new Error('Tests never fetch'))
});
