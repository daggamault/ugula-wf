import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { type Browser, chromium, type Page } from 'playwright-core';
import { config, withPcr } from './config.ts';

export { config };

const STEP_MS = config.E2E_STEP_MS;

export const FLOW_MS = config.E2E_FLOW_MS;

export const SUITE_MS = FLOW_MS * 10;

const POLL_MS = 500;

export type Session = {
  browser: Browser;
  page: Page;
  apiUrl: string;
  agencyId: string;
};

const AGENCY = /\/agencies\/([0-9a-f-]{36})/i;

export const agencyOf = (url: string) => url.match(AGENCY)?.[1] ?? '';

export const signIn = async (): Promise<Session> => {
  const browser = await chromium.launch({ channel: config.E2E_BROWSER_CHANNEL, headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true
  });
  page.setDefaultTimeout(STEP_MS);
  await page.goto(new URL('/claims', config.E2E_WEB_URL).href);
  await page.getByLabel('Email').fill(config.DEV_USER_EMAIL);
  await page.getByLabel('Password').fill(config.DEV_USER_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  const claims = page.getByRole('heading', { level: 1, name: 'Claims' });
  const chooser = page.getByRole('link', { name: /^Development Development EMS/ });
  await claims.or(chooser).first().waitFor();
  if (await chooser.isVisible()) await chooser.click();
  await claims.waitFor();
  const agencyId = agencyOf(page.url());
  assert.ok(agencyId, 'the app opens an agency');
  const apiUrl = (await page.locator('meta[name="api-url"]').getAttribute('content')) ?? '';
  assert.ok(apiUrl, 'the web app names its API');
  return { browser, page, apiUrl, agencyId };
};

export const go = (page: Page, path: string) => {
  const agencyId = agencyOf(page.url());
  const scoped = agencyId && !path.startsWith('/agencies') ? `/agencies/${agencyId}${path}` : path;
  return page.goto(new URL(scoped, config.E2E_WEB_URL).href);
};

export const apiPath = (s: Session, path: string) =>
  `${s.apiUrl}${path.replace(/^\/api\//, `/api/agencies/${s.agencyId}/`)}`;

export const heading = (page: Page, name: string | RegExp) =>
  page.getByRole('heading', { level: 1, name });

export const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' });

export const section = (page: Page, title: string) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

export const api = async <T>(s: Session, path: string) =>
  (await (await s.page.request.get(apiPath(s, path))).json()) as T;

export const until = async <T>(
  page: Page,
  read: () => Promise<T>,
  done: (value: T) => boolean,
  what: string
) => {
  const deadline = Date.now() + FLOW_MS;
  while (Date.now() < deadline) {
    const value = await read();
    if (done(value)) return value;
    await page.waitForTimeout(POLL_MS);
  }
  assert.fail(`timed out waiting for ${what}`);
};

export const uniqueId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

export const encounter = (pcr: string, fixture = 'new-patient-medicare') =>
  withPcr(readFileSync(new URL(`../fixtures/${fixture}.xml`, import.meta.url), 'utf8'), pcr);

export type ClaimState = {
  claim: {
    id: string;
    number: number;
    status: string;
    total_cents: number;
    trip_type: string | null;
    level: string | null;
    emergency: boolean | null;
    loaded_miles: string | number | null;
    origin_code: string | null;
    destination_code: string | null;
    signature: string;
    first_name: string | null;
    last_name: string | null;
    birth_date: string | null;
    coverages: { id: string; payer: string; relationship: string }[];
    lines: { code: string; units: string | number }[];
    tasks: { id: string; title: string }[];
  };
  issues: { level: string; field: string; message: string }[];
};

export const uploadEncounters = async (s: Session, pcr: string, fixture?: string) => {
  await go(s.page, '/imports');
  await s.page.locator('input[type="file"][accept*="xml"]').setInputFiles({
    name: `${pcr}.xml`,
    mimeType: 'text/xml',
    buffer: Buffer.from(encounter(pcr, fixture))
  });
  await toasts(s.page).getByText(`${pcr}.xml received`).waitFor();
};

export const importEncounter = async (s: Session, pcr: string, fixture?: string) => {
  await uploadEncounters(s, pcr, fixture);
  return draftClaim(s, pcr);
};

export const draftClaim = async (s: Session, pcr: string) => {
  const found = await until(
    s.page,
    () =>
      api<{ items: { id: string }[] }>(
        s,
        `/api/claims?number=${encodeURIComponent(pcr)}&status=all`
      ),
    (r) => r.items.length > 0,
    `the draft claim for ${pcr}`
  );
  return found.items[0]?.id ?? '';
};

export const claimState = (s: Session, claimId: string) =>
  api<ClaimState>(s, `/api/claims/${claimId}`);

export const claimStatusIs = (s: Session, claimId: string, status: string) =>
  until(
    s.page,
    () => claimState(s, claimId),
    (c) => c.claim.status === status,
    `the claim to be ${status}`
  );

const openTask = (s: Session, claimId: string, title: string) =>
  until(
    s.page,
    async () => (await claimState(s, claimId)).claim.tasks.find((t) => t.title === title),
    (t) => t !== undefined,
    `a "${title}" task`
  );

export const decide = async (page: Page, outcome?: string) => {
  const decision = section(page, 'Your Decision').last();
  await decision.waitFor();
  for (const select of await decision.locator('select').all()) {
    if (await select.inputValue()) continue;
    const values = await select
      .locator('option')
      .evaluateAll((options) => options.map((o) => o.getAttribute('value') ?? '').filter(Boolean));
    if (values[0]) await select.selectOption(values[0]);
  }
  const buttons = decision
    .locator('form > div')
    .last()
    .locator('button:not([aria-disabled="true"])');
  await (outcome ? buttons.filter({ hasText: outcome }) : buttons).first().click();
  const dialog = page.getByRole('dialog');
  const done = page.getByRole('heading', { name: 'Done' });
  await done.or(dialog).first().waitFor();
  if (await dialog.isVisible()) {
    await dialog.getByRole('button').filter({ hasNotText: 'Keep' }).last().click();
    await done.waitFor();
  }
};

export const completeTask = async (
  s: Session,
  claimId: string,
  title: string,
  options: { outcome?: string; check?: () => Promise<void> } = {}
) => {
  const task = await openTask(s, claimId, title);
  await go(s.page, `/tasks/${task?.id}`);
  await section(s.page, 'Your Decision').last().waitFor();
  await options.check?.();
  await decide(s.page, options.outcome);
};

export const uploadPayerFile = async (page: Page, name: string, text: string) => {
  await go(page, '/payer-files');
  await heading(page, 'Payer Files').waitFor();
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: 'application/edi-x12',
    buffer: Buffer.from(text)
  });
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const toast = toasts(page).getByText(new RegExp(`^${escaped} (received|could not be applied)$`));
  await toast.waitFor();
  return (await toast.textContent()) ?? '';
};

type TaskPlan = Readonly<
  Record<string, { outcome?: string; check?: () => Promise<void> } | undefined>
>;

const workTasks = async (
  s: Session,
  claimId: string,
  done: (c: ClaimState) => boolean,
  what: string,
  plan: TaskPlan = {}
) => {
  let deadline = Date.now() + FLOW_MS;
  while (Date.now() < deadline) {
    const current = await claimState(s, claimId);
    if (done(current)) return current;
    const [task] = current.claim.tasks;
    if (!task) {
      await s.page.waitForTimeout(POLL_MS);
      continue;
    }
    await completeTask(s, claimId, task.title, plan[task.title] ?? {});
    deadline = Date.now() + FLOW_MS;
  }
  assert.fail(`the claim never reached ${what}`);
};

export const workTasksUntil = (s: Session, claimId: string, status: string, plan: TaskPlan = {}) =>
  workTasks(s, claimId, (c) => c.claim.status === status, status, plan);

export const workTasksUntilTask = (
  s: Session,
  claimId: string,
  title: string,
  plan: TaskPlan = {}
) =>
  workTasks(
    s,
    claimId,
    (c) => c.claim.tasks.some((t) => t.title === title),
    `a "${title}" task`,
    plan
  );

export const latest837 = async (s: Session, claimId: string) => {
  await go(s.page, `/claims/${claimId}`);
  await heading(s.page, /^Claim #\d+$/).waitFor();
  const links = s.page.getByRole('link', { name: /^837P file #\d+$/i });
  await links.first().waitFor();
  const names = await links.allTextContents();
  const control = Math.max(...names.map((n) => Number(n.match(/#(\d+)/)?.[1])));
  const href = await s.page
    .getByRole('link', { name: `837P File #${control}`, exact: true })
    .first()
    .getAttribute('href');
  const file = await (await s.page.request.get(new URL(href ?? '', s.apiUrl).href)).text();
  return { control, file };
};

export const fileClaim = async (s: Session, claimId: string) => {
  await completeTask(s, claimId, 'Review claim', { outcome: 'Approve' });
  await until(
    s.page,
    () => claimState(s, claimId),
    (c) => !['needs_review', 'ready'].includes(c.claim.status),
    'the claim to be filed'
  );
  return latest837(s, claimId);
};
