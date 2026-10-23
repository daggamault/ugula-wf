import { type LiveEvent, parseEvent } from '@ugula/events';
import { useEffect, useRef, useSyncExternalStore } from 'react';

export type EventStream = {
  listen: (handlers: {
    onData: (data: string) => void;
    onOpen: () => void;
    /** `closed` is true when the stream gave up rather than reconnecting on its own. */
    onError: (closed: boolean) => void;
  }) => void;
  close: () => void;
};

export type LiveStatus = 'connecting' | 'online' | 'offline';

/** `null` means the stream reconnected: events may have been missed, so reload everything. */
export type LiveListener = (event: LiveEvent | null) => void;

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

export type LiveOptions = {
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
        const event = parseEvent(data);
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
        // The browser stopped retrying (for example after a server error), so retry with backoff.
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

/** How long a burst of events is gathered into one reload. */
export const COALESCE_MS = 250;

/**
 * Calls `reload` when an event the page cares about arrives, or after a reconnect. A burst of
 * events (a run checkpointing every step, a batch touching many claims) becomes one reload.
 */
export const useLive = (live: Live, matches: (event: LiveEvent) => boolean, reload: () => void) => {
  const latest = useRef({ matches, reload });
  latest.current = { matches, reload };
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = live.subscribe((event) => {
      if (timer || (event && !latest.current.matches(event))) return;
      timer = setTimeout(() => {
        timer = null;
        latest.current.reload();
      }, COALESCE_MS);
    });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [live]);
};

export const useLiveStatus = (live: Live) =>
  useSyncExternalStore(live.onStatus, live.status, () => 'connecting' as const);
