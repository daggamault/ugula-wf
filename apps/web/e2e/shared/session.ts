import assert from 'node:assert/strict';
import { MOCK_HOST_KEY } from '@ugula/billing';
import { type Browser, chromium, type Page } from 'playwright-core';
import { config, uniqueId } from './config.ts';

export { config, uniqueId };

export const STEP_MS = config.E2E_STEP_MS;

export const FLOW_MS = config.E2E_FLOW_MS;

export const SUITE_MS = FLOW_MS * 10;

const POLL_MS = 500;

export const AGENCIES = {
  paused: 'Development North',
  live: 'Development'
} as const;

export type AgencyName = (typeof AGENCIES)[keyof typeof AGENCIES];

export type Session = {
  browser: Browser;
  page: Page;
  apiUrl: string;
  agencyId: string;
};

const AGENCY = /\/agencies\/([0-9a-f-]{36})/i;

export const agencyOf = (url: string) => url.match(AGENCY)?.[1] ?? '';

const origin = new URL(config.E2E_WEB_URL).origin;

export const heading = (page: Page, name: string | RegExp) =>
  page.getByRole('heading', { level: 1, name });

const HOME = /^(Claims|Tasks)$/;

export const submitSignIn = async (page: Page) => {
  const deadline = Date.now() + STEP_MS;
  for (;;) {
    const answered = page.waitForResponse((r) => r.url().endsWith('/api/auth/sign-in'));
    await page.getByRole('button', { name: 'Sign In' }).click();
    if ((await answered).status() !== 429 || Date.now() > deadline) return;
    await page.waitForTimeout(1_000);
  }
};

export const signInAs = async (
  page: Page,
  email: string,
  password: string,
  agency: AgencyName = AGENCIES.paused
) => {
  await page.goto(new URL('/claims', config.E2E_WEB_URL).href);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await submitSignIn(page);
  await heading(page, HOME)
    .or(page.getByText('Choose an Agency', { exact: true }))
    .first()
    .waitFor();
  const apiUrl = (await page.locator('meta[name="api-url"]').getAttribute('content')) ?? '';
  assert.ok(apiUrl, 'the web app names its API');
  const { items } = (await (await page.request.get(`${apiUrl}/api/agencies`)).json()) as {
    items: { id: string; name: string }[];
  };
  const agencyId = items.find((a) => a.name === agency)?.id ?? '';
  assert.ok(agencyId, `${email} belongs to ${agency}`);
  await page.goto(new URL(`/agencies/${agencyId}/claims`, config.E2E_WEB_URL).href);
  await heading(page, HOME).waitFor();
  return { apiUrl, agencyId };
};

const PAUSED_MOCK = {
  vendor: 'mock',
  isActive: false,
  sftpHost: 'localhost',
  sftpPort: 2223,
  sftpHostKey: MOCK_HOST_KEY,
  sftpUsername: 'e2e-paused',
  secret: 'e2e-paused',
  uploadPath: '/upload',
  downloadPaths: ['/download'],
  claimExtension: '.CLP',
  eligibilityExtension: '.ELG',
  claimStatusExtension: '.CLS',
  afterDownload: 'delete',
  realtimeUrl: null
} as const;

const pauseClearinghouse = async (s: Session) => {
  const { connection } = await api<{ connection: { is_active: boolean } | null }>(
    s,
    '/api/clearinghouse-connection'
  );
  if (connection?.is_active === false) return;
  await send(s, 'PUT', '/api/clearinghouse-connection', PAUSED_MOCK);
};

export const signIn = async (agency: AgencyName = AGENCIES.paused): Promise<Session> => {
  const browser = await chromium.launch({ channel: config.E2E_BROWSER_CHANNEL, headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true
  });
  page.setDefaultTimeout(STEP_MS);
  const { apiUrl, agencyId } = await signInAs(
    page,
    config.DEV_USER_EMAIL,
    config.DEV_USER_PASSWORD,
    agency
  );
  const s = { browser, page, apiUrl, agencyId };
  if (agency === AGENCIES.paused) await pauseClearinghouse(s);
  return s;
};

export const go = (page: Page, path: string) => {
  const agencyId = agencyOf(page.url());
  const scoped = agencyId && !path.startsWith('/agencies') ? `/agencies/${agencyId}${path}` : path;
  return page.goto(new URL(scoped, config.E2E_WEB_URL).href);
};

export const apiPath = (s: Session, path: string) =>
  `${s.apiUrl}${path.replace(/^\/api\//, `/api/agencies/${s.agencyId}/`)}`;

export const apiUrlOf = (s: Session, href: string) => new URL(href, s.apiUrl).href;

export const api = async <T>(s: Session, path: string) => {
  const res = await s.page.request.get(apiPath(s, path));
  assert.ok(res.ok(), `GET ${path} answered ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
};

export const apiText = async (s: Session, path: string) => {
  const res = await s.page.request.get(path.startsWith('/api/') ? apiPath(s, path) : path);
  assert.ok(res.ok(), `GET ${path} answered ${res.status()}`);
  return res.text();
};

export const send = async <T>(
  s: Session,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  data?: unknown
) => {
  const res = await s.page.request.fetch(apiPath(s, path), {
    method,
    headers: { origin },
    ...(data === undefined ? {} : { data })
  });
  assert.ok(res.ok(), `${method} ${path} answered ${res.status()}: ${await res.text()}`);
  const body = await res.text();
  return (body ? JSON.parse(body) : null) as T;
};

export const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' });

export const toast = (page: Page, text: string | RegExp) =>
  toasts(page).getByText(text).first().waitFor();

export const section = (page: Page, title: string) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

const RESTARTING = /ECONNREFUSED|ECONNRESET|socket hang up|answered 50[234]/;

export const until = async <T>(
  page: Page,
  read: () => Promise<T>,
  done: (value: T) => boolean,
  what: string,
  ms = FLOW_MS
) => {
  const deadline = Date.now() + ms;
  let last: T | undefined;
  while (Date.now() < deadline) {
    try {
      last = await read();
    } catch (err) {
      if (!RESTARTING.test(String(err))) throw err;
      await page.waitForTimeout(POLL_MS);
      continue;
    }
    if (done(last)) return last;
    await page.waitForTimeout(POLL_MS);
  }
  assert.fail(`timed out waiting for ${what}; last saw ${JSON.stringify(last)?.slice(0, 2000)}`);
};

export const confirmDelete = async (page: Page, name: string) => {
  const dialog = page.getByRole('dialog', { name: `Delete ${name}?` });
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await toast(page, `${name} deleted`);
};

export const rowWith = (page: Page, text: string) =>
  page.getByRole('row').filter({ hasText: text });

export const chooseFile = async (
  page: Page,
  button: string,
  file: { name: string; mimeType: string; buffer: Buffer }
) => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: button, exact: true }).click();
  await (await chooser).setFiles(file);
};
