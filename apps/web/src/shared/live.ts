import { type LiveEvent, parseEvent } from '@ugula/events';
import { useEffect, useRef } from 'react';

export type EventStream = {
  listen: (onData: (data: string) => void) => void;
  close: () => void;
};

export type Live = {
  subscribe: (listener: (event: LiveEvent) => void) => () => void;
  close: () => void;
};

const openEventSource = (url: string): EventStream => {
  const source = new EventSource(url, { withCredentials: true });
  return {
    listen: (onData) => {
      source.onmessage = (message) => onData(String(message.data));
    },
    close: () => source.close()
  };
};

export const createLive = (sseUrl: string, open = openEventSource): Live => {
  const listeners = new Set<(event: LiveEvent) => void>();
  let source: EventStream | null = null;
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      if (!source) {
        source = open(`${sseUrl}/events`);
        source.listen((data) => {
          const event = parseEvent(data);
          if (event) for (const l of listeners) l(event);
        });
      }
      return () => {
        listeners.delete(listener);
      };
    },
    close: () => {
      source?.close();
      source = null;
    }
  };
};

export const useLive = (live: Live, onEvent: (event: LiveEvent) => void) => {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => live.subscribe((event) => handler.current(event)), [live]);
};
