export type LiveEvent =
  | { kind: 'run'; id: string; status: string; parentId: string | null }
  | { kind: 'task'; id: string | null; runId: string | null }
  | { kind: 'claim'; id: string | null }
  | { kind: 'import'; id: string | null }
  | { kind: 'notification'; id: string | null };

export type LiveKind = LiveEvent['kind'];

export type Publisher = {
  publish: (channel: string, message: string) => Promise<unknown>;
};

const PREFIX = 'live:';

export const LIVE_PATTERN = `${PREFIX}*`;

export const channelOf = (tenantId: string) => `${PREFIX}${tenantId}`;

export const tenantOf = (channel: string) =>
  channel.startsWith(PREFIX) ? channel.slice(PREFIX.length) : null;

export const publishLiveEvent = async (redis: Publisher, tenantId: string, event: LiveEvent) => {
  await redis.publish(channelOf(tenantId), JSON.stringify(event));
};

type Fields = Record<string, unknown>;

const isText = (value: unknown): value is string => typeof value === 'string';
const isOptionalText = (value: unknown): value is string | null => value === null || isText(value);

const parsers: { [K in LiveKind]: (v: Fields) => Extract<LiveEvent, { kind: K }> | null } = {
  run: ({ id, status, parentId = null }) =>
    isText(id) && isText(status) && isOptionalText(parentId)
      ? { kind: 'run', id, status, parentId }
      : null,
  task: ({ id, runId = null }) =>
    isOptionalText(id) && isOptionalText(runId) ? { kind: 'task', id, runId } : null,
  claim: ({ id }) => (isOptionalText(id) ? { kind: 'claim', id } : null),
  import: ({ id }) => (isOptionalText(id) ? { kind: 'import', id } : null),
  notification: ({ id }) => (isOptionalText(id) ? { kind: 'notification', id } : null)
};

const isKind = (kind: unknown): kind is LiveKind => isText(kind) && Object.hasOwn(parsers, kind);

export const parseLiveEvent = (message: string): LiveEvent | null => {
  try {
    const value: unknown = JSON.parse(message);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const fields = value as Fields;
    return isKind(fields.kind) ? parsers[fields.kind](fields) : null;
  } catch {
    return null;
  }
};
