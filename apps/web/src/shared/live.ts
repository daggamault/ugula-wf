import { type LiveEvent, parseLiveEvent } from '@ugula/live';
import { useEffect, useRef, useSyncExternalStore } from 'react';

export type EventStream = {
  listen: (handlers: {
    onData: (data: string) => void;
    onOpen: () => void;
    onError: (closed: boolean) => void;
  }) => void;
  close: () => void;
};

export type LiveStatus = 'connecting' | 'online' | 'offline';

type LiveListener = (event: LiveEvent | null) => void;

export type Live = {
  subscribe: (listener: LiveListener) => () => void;
  status: () => LiveStatus;
  onStatus: (listener: () => void) => () => void;
  close: () => void;
};

const openEventSource = (url: string): EventStream => {
  const source = new EventSource(url, { withCredentials: true });
  return {
    listen: ({ onData, onOpen, onError }) => {
      source.onmessage = (message) => onData(String(message.data));
      source.onopen = onOpen;
      source.onerror = () => onError(source.readyState === EventSource.CLOSED);
    },
    close: () => source.close()
  };
};

const RETRY_MS = [1_000, 5_000, 15_000, 30_000];

type LiveOptions = {
  open?: (url: string) => EventStream;
  schedule?: (run: () => void, ms: number) => () => void;
};

const after = (run: () => void, ms: number) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

export const createLive = (
  sseUrl: string,
  { open = openEventSource, schedule = after }: LiveOptions = {}
): Live => {
  const listeners = new Set<LiveListener>();
  const watchers = new Set<() => void>();
  let source: EventStream | null = null;
  let status: LiveStatus = 'connecting';
  let missed = false;
  let failures = 0;
  let cancelRetry: (() => void) | null = null;

  const setStatus = (next: LiveStatus) => {
    if (next === status) return;
    status = next;
    for (const w of watchers) w();
  };

  const connect = () => {
    if (source) return;
    const stream = open(`${sseUrl}/events`);
    source = stream;
    stream.listen({
      onData: (data) => {
        const event = parseLiveEvent(data);
        if (event) for (const l of listeners) l(event);
      },
      onOpen: () => {
        failures = 0;
        setStatus('online');
        if (missed) for (const l of listeners) l(null);
        missed = false;
      },
      onError: (closed) => {
        missed = true;
        setStatus('offline');
        if (!closed || source !== stream) return;
        stream.close();
        source = null;
        const delay = RETRY_MS[Math.min(failures++, RETRY_MS.length - 1)] ?? 30_000;
        cancelRetry = schedule(() => {
          cancelRetry = null;
          connect();
        }, delay);
      }
    });
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      connect();
      return () => {
        listeners.delete(listener);
      };
    },
    status: () => status,
    onStatus: (watcher) => {
      watchers.add(watcher);
      connect();
      return () => {
        watchers.delete(watcher);
      };
    },
    close: () => {
      cancelRetry?.();
      cancelRetry = null;
      source?.close();
      source = null;
    }
  };
};

const COALESCE_MS = 250;

export const LIST_RELOAD_MS = 1_500;

export const isOnPage = (id: string | null, page: number, visible: readonly (string | null)[]) =>
  id === null || page === 1 || visible.includes(id);

export const createBurst = (
  run: () => void,
  ms: number,
  schedule: (run: () => void, ms: number) => () => void = after
) => {
  let cancel: (() => void) | null = null;
  return {
    push: () => {
      cancel ??= schedule(() => {
        cancel = null;
        run();
      }, ms);
    },
    stop: () => {
      cancel?.();
      cancel = null;
    }
  };
};

export const useLive = (
  live: Live,
  matches: (event: LiveEvent) => boolean,
  reload: () => void,
  ms = COALESCE_MS
) => {
  const latest = useRef({ matches, reload });
  latest.current = { matches, reload };
  useEffect(() => {
    const burst = createBurst(() => latest.current.reload(), ms);
    const stop = live.subscribe((event) => {
      if (!event || latest.current.matches(event)) burst.push();
    });
    return () => {
      stop();
      burst.stop();
    };
  }, [live, ms]);
};

export const useLiveStatus = (live: Live) =>
  useSyncExternalStore(live.onStatus, live.status, () => 'connecting' as const);

const NONE = () => false;

export const useReconnect = (live: Live, reload: () => void) => useLive(live, NONE, reload);
