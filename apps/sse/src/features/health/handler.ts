import type { ServerResponse } from 'node:http';
import { sendJson } from '../../shared/http.ts';

export const handleHealth = (res: ServerResponse) => {
  sendJson(res, 200, { status: 'ok' });
};
