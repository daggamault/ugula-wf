import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { parseConfig } from './config.ts';
import { handleHealth } from './features/health/handler.ts';
import { sendJson } from './shared/http.ts';

export const handleRequest = (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === 'GET' && req.url === '/health') {
    handleHealth(res);
    return;
  }

  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    });
    res.write(': connected\n\n');
    return;
  }

  sendJson(res, 404, { error: 'Not Found' });
};

export const createSseServer = () => createServer(handleRequest);

if (import.meta.main) {
  const config = parseConfig(process.env);
  createSseServer().listen(config.SSE_PORT);
}
