import { createHash } from 'node:crypto';

export const hostKeyFingerprint = (key: Buffer) =>
  `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
