---
name: run-app
description: Launch the ugula stack (worker, api, sse, web) against local Docker services and drive it in headless Edge to verify workflows, runs, live updates and task queues end to end.
---

# Run and drive ugula

## Prerequisites

- Docker services healthy: `docker compose ps` (postgres, redis and rustfs; the worker creates the S3 bucket on start).
- Schema and seed data: `pnpm db:migrate && pnpm db:seed:dev` (resets workflow tables, publishes the `billing.*` graphs and the dev `demo.*` graphs).
- Ports 3000 (web), 3001 (api), 3002 (sse) free. Check before starting:
  `powershell -NoProfile -Command "Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 3000,3001,3002"`.
  If something listens, identify it with `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"` before touching it; the user's own `pnpm dev` uses `tsx watch` and `--env-file-if-exists`.

## Start (each as a background task)

```bash
cd apps/worker && pnpm exec tsx --env-file=../../.env src/main.ts
cd apps/api && pnpm exec tsx --env-file=../../.env src/main.ts
cd apps/sse && pnpm exec tsx --env-file=../../.env src/main.ts
cd apps/web && pnpm exec vite "$PWD" --strictPort --config "$PWD/vite.config.ts"   # absolute paths: background shells may not keep the cd
```

Wait until `curl -sf http://localhost:3000`, `http://localhost:3001/health` and `http://localhost:3002/health` all succeed.

## Drive

Install the driver outside the repo (never add it to package.json), and use the installed Edge:

```bash
mkdir -p "$SCRATCH/driver" && cd "$SCRATCH/driver" && npm init -y && npm i playwright-core@1
```

```js
import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto('http://localhost:3000/workflows');
await page.getByLabel('Email').fill(DEV_USER_EMAIL);
await page.getByLabel('Password').fill(DEV_USER_PASSWORD);
await page.getByRole('button', { name: 'Sign In' }).click();
await page.getByRole('heading', { name: 'Workflows' }).waitFor();
```

Read `DEV_USER_EMAIL` / `DEV_USER_PASSWORD` from `.env`. `context.request` shares the session cookie, so it can call the API (`http://localhost:3001/api/...`) as the signed-in user, which is how to act as "another client" when checking live updates.

Representative path: open `Process Batch` → `Run` → fill `items` with JSON → `Start run` → `/tasks` → `Work next` on `review` → fill `note` → `Approve` (the page auto-advances to the next task) → back on the run, wait for the level-1 heading to contain `Completed`. Screenshot each step and look at the screenshots.

NEMSIS path: `/imports` → `page.getByLabel('NEMSIS XML file').setInputFiles(path)` → `Import` → the ingest run waits on one `Process PCR` child per report → each child resolves its patient (exact match, auto-create, or a `Confirm patient` task in `billing-patients` with candidate choices and editable demographics) → work the `billing-review` queue, where the level of service, emergency flag and loaded miles are prefilled from the `billing.level-of-service` rules (`getByLabel('Level of service')`, `Emergency response`, `Loaded miles`) → approval prices the claim from `/fees` (dev seed: default schedule for A0425–A0434) → the ingest completes with `count` and `summaries`, and each Process PCR result has `charges` and a `claimId`. Approval also opens a claim and starts a detached `billing.cycle-claim` run: it submits to each payer on the claim in order (submission is only recorded until a clearinghouse exists), waits 30 days per payer (timeout → `billing-followup` task), then sends 3 patient statements 30 days apart and finally a `billing-collections` task. Drive it from `/claims/<id>`: record responses/payments (`From`, `Paid (USD)`, `Adjusted (USD)`) or edit payer order (`New payer`, `Move X up`, `Save payer order`); both signal the cycle (`claim:<id>`) so history updates within a second. Reports need `eDisposition.32` (ALS/Critical Care) for a non-BLS suggestion, `eResponse.20/.21/.23` for miles and emergency, and a Primary `ePayment.InsuranceGroup` (or `ePayment.01` Medicare/Medicaid) for payer prices. Review tasks arrive as each child reaches them, so keep working the queue until the ingest heading says `Completed`; wait for the queue row before checking it (`row.waitFor`), since the tasks table loads after the heading. Imported files and per-report JSON live in S3 under `imports/<tenant>/...`; run state only holds keys.

## Gotchas

- The pre-sign-in `GET /api/auth/me` 401 is expected (StrictMode runs it twice).
- Assert run state on the level-1 heading; child-run badges also say "Completed".
- Node inputs in the editor are grouped by pin: scope with `page.getByRole('group', { name: /pinName/ })` before `getByLabel('Value', { exact: true })`.
- Wire pins with `node.locator('.react-flow__handle.source[data-handleid="exec"]').dragTo(...)`.
- Stopping a background task stops the `pnpm` wrapper, not its `node` child. Stop only your own processes by exact command line:
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { ($_.CommandLine -like '*--env-file=../../.env src/main.ts*' -and $_.CommandLine -notlike '*watch*') -or $_.CommandLine -like '*vite.js*--strictPort*' }`, then `Stop-Process -Id <those ids>`.
