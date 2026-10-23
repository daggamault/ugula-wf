const TRANSIENT_SQL_CLASSES = new Set(['08', '40', '53', '57', '58']);

const TRANSIENT_NET_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN'
]);

const codeOf = (err: unknown) =>
  err instanceof Error && 'code' in err && typeof err.code === 'string' ? err.code : '';

export const isTransient = (err: unknown) => {
  const code = codeOf(err);
  if (/^[0-9A-Z]{5}$/.test(code)) return TRANSIENT_SQL_CLASSES.has(code.slice(0, 2));
  if (TRANSIENT_NET_CODES.has(code)) return true;
  return err instanceof Error && /connection (terminated|ended)|timeout/i.test(err.message);
};
