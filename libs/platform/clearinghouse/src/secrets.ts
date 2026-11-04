import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

const KEY_BYTES = 32;

const IV_BYTES = 12;

const TAG_BYTES = 16;

const VERSION = 'v1';

export type SecretKey = { bytes: Buffer };

export const parseSecretKey = (base64: string): SecretKey => {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length !== KEY_BYTES || bytes.toString('base64') !== base64.trim()) {
    throw new Error(`The secret key must be ${KEY_BYTES} bytes, base64 encoded`);
  }
  return { bytes };
};

export const sealSecret = (key: SecretKey, plain: string, context: string) => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key.bytes, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), body]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64')))
    .join('.');
};

export const openSecret = (key: SecretKey, sealed: string, context: string) => {
  const [version, iv, tag, body, ...rest] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || body === undefined || rest.length) {
    throw new Error('Not a sealed secret');
  }
  const decipher = createDecipheriv(ALGORITHM, key.bytes, Buffer.from(iv, 'base64'), {
    authTagLength: TAG_BYTES
  });
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString(
    'utf8'
  );
};
