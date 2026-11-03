const TRANSIENT_SQL_CLASSES = new Set(['08', '40', '53', '57', '58']);

const TRANSIENT_NET_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT'
]);

const TRANSIENT_NAMES = new Set(['AbortError', 'TimeoutError', 'MaxRetriesPerRequestError']);

const TRANSIENT_MESSAGE =
  /connection (terminated|ended|is closed)|timeout|timed out|fetch failed|answered (5\d\d|429)\b/i;

const codeOf = (err: Error) => ('code' in err && typeof err.code === 'string' ? err.code : '');

const classify = (err: Error) => {
  const code = codeOf(err);
  if (TRANSIENT_NET_CODES.has(code)) return true;
  if (/^[0-9A-Z]{5}$/.test(code)) return TRANSIENT_SQL_CLASSES.has(code.slice(0, 2));
  return TRANSIENT_NAMES.has(err.name) || TRANSIENT_MESSAGE.test(err.message);
};

export const isTransient = (err: unknown): boolean =>
  err instanceof Error && (classify(err) || isTransient(err.cause));
