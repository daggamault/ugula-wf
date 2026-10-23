export type ApiError = Error & {
  status: number;
  body: Record<string, unknown>;
};

export type Api = {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
  put: <T>(path: string, body: unknown) => Promise<T>;
  remove: <T>(path: string) => Promise<T>;
  upload: <T>(path: string, form: FormData) => Promise<T>;
  href: (path: string) => string;
};

export const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const isApiError = (err: unknown): err is ApiError =>
  err instanceof Error && 'status' in err && 'body' in err;

const apiError = (status: number, body: unknown): ApiError => {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const message =
    typeof record.error === 'string' ? record.error : `Request failed with status ${status}`;
  return Object.assign(new Error(message), { status, body: record });
};

const AUTH_PATH = '/api/auth/';

export const createApi = (
  baseUrl: string,
  fetchFn: typeof fetch = fetch,
  onUnauthorized: () => void = () => undefined
): Api => {
  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetchFn(`${baseUrl}${path}`, {
      method,
      credentials: 'include',
      ...(body === undefined
        ? {}
        : body instanceof FormData
          ? { body }
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    });
    const data: unknown = await res.json().catch(() => null);
    if (res.status === 401 && !path.startsWith(AUTH_PATH)) onUnauthorized();
    if (!res.ok) throw apiError(res.status, data);
    return data as T;
  };
  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    remove: (path) => request('DELETE', path),
    upload: (path, form) => request('POST', path, form),
    href: (path) => `${baseUrl}${path}`
  };
};
