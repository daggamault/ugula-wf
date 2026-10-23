import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, type AppClients } from './app.tsx';
import { type Config, parseConfig } from './config.ts';
import { createAuthClient } from './features/auth/client.ts';
import { createClaimsClient } from './features/claims/client.ts';
import { createFeesClient } from './features/fees/client.ts';
import { createImportsClient } from './features/imports/client.ts';
import { createRunsClient } from './features/runs/client.ts';
import { createSettingsClient } from './features/settings/client.ts';
import { createSubmissionsClient } from './features/submissions/client.ts';
import { createTasksClient } from './features/tasks/client.ts';
import { createWorkflowsClient } from './features/workflows/client.ts';
import { createApi } from './shared/api.ts';

export const createClients = (config: Config, fetchFn: typeof fetch = fetch): AppClients => {
  const api = createApi(config.apiUrl, fetchFn);
  return {
    auth: createAuthClient(api),
    workflows: createWorkflowsClient(api),
    runs: createRunsClient(api),
    tasks: createTasksClient(api),
    imports: createImportsClient(api),
    fees: createFeesClient(api),
    claims: createClaimsClient(api),
    settings: createSettingsClient(api),
    submissions: createSubmissionsClient(api)
  };
};

export const mountApp = (el: HTMLElement | null, config: Config) => {
  if (!el) throw new Error('Missing root element');
  createRoot(el).render(
    createElement(StrictMode, null, createElement(App, { clients: createClients(config) }))
  );
};

if (typeof document !== 'undefined') {
  mountApp(document.getElementById('root'), parseConfig(document));
}
