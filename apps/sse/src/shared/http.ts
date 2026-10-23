import type { ServerResponse } from 'node:http';

export const sendJson = (
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

export const corsHeaders = (
  origin: string | undefined,
  allowed: readonly string[]
): Record<string, string> =>
  origin && allowed.includes(origin)
    ? {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        vary: 'Origin'
      }
    : {};
