import { randomUUID } from 'node:crypto';

export type CoreConfig = {
  url: string;
  username: string;
  password: string;
  senderId: string;
  receiverId: string;
  timeoutMs: number;
  fetch: typeof fetch;
  now?: () => Date;
  newId?: () => string;
};

export type CoreReply =
  | { ok: true; payloadType: string; payload: string }
  | { ok: false; error: string };

const CORE_RULE_VERSION = '2.2.0';

const SUCCESS = 'Success';

const timestampOf = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;

const isTimeout = (err: unknown) =>
  err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError');

const envelopeOf = (c: CoreConfig, payloadType: string, payload: string, id: string) => {
  const form = new FormData();
  const fields: Record<string, string> = {
    PayloadType: payloadType,
    ProcessingMode: 'RealTime',
    PayloadID: id,
    TimeStamp: timestampOf((c.now ?? (() => new Date()))()),
    SenderID: c.senderId,
    ReceiverID: c.receiverId,
    CORERuleVersion: CORE_RULE_VERSION,
    Payload: payload
  };
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return form;
};

const readReply = async (res: Response, id: string): Promise<CoreReply> => {
  if (!res.ok) return { ok: false, error: `The clearinghouse answered HTTP ${res.status}` };
  let form: FormData;
  try {
    form = await res.formData();
  } catch {
    return { ok: false, error: 'The clearinghouse answer is not a CORE envelope' };
  }
  const field = (name: string) => {
    const v = form.get(name);
    return typeof v === 'string' ? v : '';
  };
  const code = field('ErrorCode');
  if (code && code !== SUCCESS) {
    return { ok: false, error: [code, field('ErrorMessage')].filter(Boolean).join(': ') };
  }
  if (field('PayloadID') && field('PayloadID') !== id) {
    return { ok: false, error: 'The clearinghouse answered another request' };
  }
  return { ok: true, payloadType: field('PayloadType'), payload: field('Payload') };
};

export const createCoreRealtime =
  (c: CoreConfig) =>
  async (payloadType: string, payload: string): Promise<CoreReply> => {
    const id = (c.newId ?? randomUUID)();
    try {
      const res = await c.fetch(c.url, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${c.username}:${c.password}`).toString('base64')}`
        },
        body: envelopeOf(c, payloadType, payload, id),
        signal: AbortSignal.timeout(c.timeoutMs)
      });
      return await readReply(res, id);
    } catch (err) {
      return {
        ok: false,
        error: isTimeout(err)
          ? `The clearinghouse did not answer within ${c.timeoutMs / 1000}s`
          : `Could not reach the clearinghouse: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  };
