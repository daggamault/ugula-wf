import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

const KEY_BYTES = 32;

const IV_BYTES = 12;

const TAG_BYTES = 16;

const KEY_ID_LENGTH = 8;

const VERSION = 'v1';

type SecretKey = { id: string; bytes: Buffer };

export type SecretKeyring = { current: SecretKey; keys: ReadonlyMap<string, SecretKey> };

const parseSecretKey = (base64: string): SecretKey => {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length !== KEY_BYTES || bytes.toString('base64') !== base64.trim()) {
    throw new Error(`The secret key must be ${KEY_BYTES} bytes, base64 encoded`);
  }
  const id = createHash('sha256').update(bytes).digest('base64url').slice(0, KEY_ID_LENGTH);
  return { id, bytes };
};

export const parseKeyring = (current: string, previous: readonly string[] = []): SecretKeyring => {
  const key = parseSecretKey(current);
  return {
    current: key,
    keys: new Map([key, ...previous.map(parseSecretKey)].map((k) => [k.id, k]))
  };
};

const partsOf = (sealed: string) => {
  const [version, keyId, iv, tag, body, ...rest] = sealed.split('.');
  if (version !== VERSION || !keyId || !iv || !tag || body === undefined || rest.length) {
    throw new Error('Not a sealed secret');
  }
  return { keyId, iv, tag, body };
};

export const sealSecret = (ring: SecretKeyring, plain: string, context: string) => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, ring.current.bytes, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, ring.current.id, iv, cipher.getAuthTag(), body]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64')))
    .join('.');
};

export const openSecret = (ring: SecretKeyring, sealed: string, context: string) => {
  const { keyId, iv, tag, body } = partsOf(sealed);
  const key = ring.keys.get(keyId);
  if (!key) throw new Error(`The secret was sealed with key ${keyId}, which is not configured`);
  const decipher = createDecipheriv(ALGORITHM, key.bytes, Buffer.from(iv, 'base64'), {
    authTagLength: TAG_BYTES
  });
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString(
    'utf8'
  );
};

export const needsReseal = (ring: SecretKeyring, sealed: string) => {
  try {
    const { keyId } = partsOf(sealed);
    return keyId !== ring.current.id && ring.keys.has(keyId);
  } catch {
    return false;
  }
};
