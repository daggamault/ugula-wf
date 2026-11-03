import { createNodeCatalog } from '@ugula/catalog';
import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, type AppClients } from './app.tsx';
import { type Config, parseConfig } from './config.ts';
import { createAuthClient } from './features/auth/client.ts';
import { createClaimsClient } from './features/claims/client.ts';
import { createFeesClient } from './features/fees/client.ts';
import { createImportsClient } from './features/imports/client.ts';
import { createPatientsClient } from './features/patients/client.ts';
import { createReportsClient } from './features/reports/client.ts';
import { createRunsClient } from './features/runs/client.ts';
import { createSettingsClient } from './features/settings/client.ts';
import { createTasksClient } from './features/tasks/client.ts';
import { createWorkflowsClient } from './features/workflows/client.ts';
import { createApi } from './shared/api.ts';
import { createNotificationsClient } from './shared/notifications.ts';
import { createSignal } from './shared/signal.ts';

export const createClients = (config: Config, fetchFn: typeof fetch = fetch): AppClients => {
  const expired = createSignal();
  const api = createApi(config.apiUrl, fetchFn, expired.emit);
  return {
    auth: createAuthClient(api, expired),
    workflows: createWorkflowsClient(api),
    runs: createRunsClient(api),
    tasks: createTasksClient(api),
    imports: createImportsClient(api),
    fees: createFeesClient(api),
    claims: createClaimsClient(api),
    patients: createPatientsClient(api),
    settings: createSettingsClient(api),
    reports: createReportsClient(api),
    notifications: createNotificationsClient(api)
  };
};

export const mountApp = (el: HTMLElement | null, config: Config) => {
  if (!el) throw new Error('Missing root element');
  createRoot(el).render(
    createElement(
      StrictMode,
      null,
      createElement(App, {
        clients: createClients(config),
        nodes: createNodeCatalog({ fetch: (...args) => fetch(...args) })
      })
    )
  );
};

if (typeof document !== 'undefined') {
  mountApp(document.getElementById('root'), parseConfig(document));
}
