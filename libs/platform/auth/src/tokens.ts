import { createHash, randomBytes } from 'node:crypto';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const createToken = () => {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
};
