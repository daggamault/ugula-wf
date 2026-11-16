import { timingSafeEqual } from 'node:crypto';

export type Credentials = { username: string; password: string };

const matches = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

export const credentialsMatch = (expected: Credentials, given: Credentials) =>
  matches(given.username, expected.username) && matches(given.password, expected.password);

export const isBasicAuthorized = (expected: Credentials, header: string | null) => {
  const [scheme, value] = (header ?? '').split(' ');
  if (scheme !== 'Basic' || !value) return false;
  const [username = '', ...password] = Buffer.from(value, 'base64').toString('utf8').split(':');
  return credentialsMatch(expected, { username, password: password.join(':') });
};
