import { performance } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';

export type LoadSample = { eventLoop: number; heapBytes: number; rssBytes: number };

type LoadLimits = { eventLoop: number; heapBytes: number; rssBytes: number | null };

export type LoadGate = () => { open: boolean; reason: string | null };

const MB = 1024 * 1024;

const RESUME_RATIO = 0.9;

const DEFAULT_HEAP_SHARE = 0.85;

export const defaultHeapBytes = () =>
  Math.floor(getHeapStatistics().heap_size_limit * DEFAULT_HEAP_SHARE);

export const megabytes = (mb: number) => mb * MB;

export const createProcessSampler = () => {
  let last = performance.eventLoopUtilization();
  return (): LoadSample => {
    const now = performance.eventLoopUtilization();
    const { utilization } = performance.eventLoopUtilization(now, last);
    last = now;
    const { heapUsed, rss } = process.memoryUsage();
    return { eventLoop: utilization, heapBytes: heapUsed, rssBytes: rss };
  };
};

const percent = (x: number) => `${Math.round(x * 100)}%`;

const mb = (bytes: number) => `${Math.round(bytes / MB)} MB`;

export const overloadOf = (s: LoadSample, limits: LoadLimits, ratio = 1) =>
  s.eventLoop > limits.eventLoop * ratio
    ? `event loop ${percent(s.eventLoop)} over ${percent(limits.eventLoop * ratio)}`
    : s.heapBytes > limits.heapBytes * ratio
      ? `heap ${mb(s.heapBytes)} over ${mb(limits.heapBytes * ratio)}`
      : limits.rssBytes !== null && s.rssBytes > limits.rssBytes * ratio
        ? `memory ${mb(s.rssBytes)} over ${mb(limits.rssBytes * ratio)}`
        : null;

export const createLoadGate = (sample: () => LoadSample, limits: LoadLimits): LoadGate => {
  let open = true;
  return () => {
    const reason = overloadOf(sample(), limits, open ? 1 : RESUME_RATIO);
    open = reason === null;
    return { open, reason };
  };
};
