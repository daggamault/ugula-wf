import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { type Config, parseConfig } from './config.ts';
import { AuthGate } from './features/auth/auth-gate.tsx';
import { createAuthClient } from './features/auth/client.ts';
import { HealthStatus } from './features/health/health-status.tsx';

export const mountApp = (el: HTMLElement | null, config: Config) => {
  if (!el) throw new Error('Missing root element');
  const auth = createAuthClient(config.apiUrl);
  createRoot(el).render(
    createElement(
      StrictMode,
      null,
      createElement(AuthGate, { auth, status: createElement(HealthStatus) })
    )
  );
};

if (typeof document !== 'undefined') {
  mountApp(document.getElementById('root'), parseConfig(document));
}
