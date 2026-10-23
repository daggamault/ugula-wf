export type LiveEvent = {
  kind: 'run';
  id: string;
  status: string;
};

export type Publisher = {
  publish: (channel: string, message: string) => Promise<unknown>;
};

const PREFIX = 'events:';

export const EVENTS_PATTERN = `${PREFIX}*`;

export const channelOf = (tenantId: string) => `${PREFIX}${tenantId}`;

export const tenantOf = (channel: string) =>
  channel.startsWith(PREFIX) ? channel.slice(PREFIX.length) : null;

export const publishEvent = async (redis: Publisher, tenantId: string, event: LiveEvent) => {
  await redis.publish(channelOf(tenantId), JSON.stringify(event));
};

export const parseEvent = (message: string): LiveEvent | null => {
  try {
    const value: unknown = JSON.parse(message);
    return typeof value === 'object' &&
      value !== null &&
      'kind' in value &&
      value.kind === 'run' &&
      'id' in value &&
      typeof value.id === 'string' &&
      'status' in value &&
      typeof value.status === 'string'
      ? { kind: 'run', id: value.id, status: value.status }
      : null;
  } catch {
    return null;
  }
};
