import { randomBytes, type ScryptOptions, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify<string, string, number, ScryptOptions, Buffer>(scryptCb);
const KEY_LEN = 64;
const COST = { N: 2 ** 17, r: 8, p: 1 };
const LEGACY_COST = { N: 2 ** 14, r: 8, p: 1 };
const MAX_N = 2 ** 20;

type Cost = typeof COST;

const derive = (password: string, salt: string, { N, r, p }: Cost) =>
  scrypt(password, salt, KEY_LEN, { N, r, p, maxmem: 256 * N * r });

const parseHash = (stored: string) => {
  if (!stored.startsWith('scrypt$')) {
    const [salt, key, ...rest] = stored.split(':');
    return salt && key && !rest.length ? { cost: LEGACY_COST, salt, key } : null;
  }
  const [, n, r, p, salt, key, ...rest] = stored.split('$');
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  const valid =
    Number.isInteger(Math.log2(cost.N)) &&
    cost.N > 1 &&
    cost.N <= MAX_N &&
    [cost.r, cost.p].every((x) => Number.isInteger(x) && x >= 1 && x <= 16);
  return valid && salt && key && !rest.length ? { cost, salt, key } : null;
};

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, COST);
  return `scrypt$${COST.N}$${COST.r}$${COST.p}$${salt}$${key.toString('hex')}`;
};

export const verifyPassword = async (password: string, storedHash: string): Promise<boolean> => {
  const parsed = parseHash(storedHash);
  if (!parsed) return false;
  const expected = Buffer.from(parsed.key, 'hex');
  if (expected.length !== KEY_LEN) return false;
  return timingSafeEqual(expected, await derive(password, parsed.salt, parsed.cost));
};
