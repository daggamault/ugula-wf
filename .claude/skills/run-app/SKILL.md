---
name: run-app
description: Launch the ugula stack (worker, api, sse, web) against local Docker services and drive it in headless Edge to verify workflows, runs, live updates and task queues end to end.
---

# Run and drive ugula

## Prerequisites

- Docker services healthy: `docker compose ps` (postgres, redis, rustfs, embeddings and completions; the worker creates the S3 bucket on start and embeds directory payers on first use).
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

Representative path: open `Process Batch` → `Run` → fill `items` with JSON → `Start Run` → `/tasks` (the landing page: one task list with `Filter by type` and `Filter by who it is assigned to` pills, kept in the URL as `queue` and `assignee`) → `Start working` (takes the oldest unassigned task of the selected type, or of any type) → fill `note` → `Approve` → the decision panel turns into `Done` with `Next task` / `Back to Tasks` → back on the run, wait for the level-1 heading to contain `Completed`. Task types show as labels (`billing-review` is `PCR review`, `billing-payers` is `Payer matching`, `exceptions` is `Stuck runs`). `Assign to me` / `Unassign` on a task replace the old claim/release wording. Screenshot each step and look at the screenshots.

NEMSIS path: drop the file anywhere (dispatch `dragenter` then `drop` `DragEvent`s on `window` with a `DataTransfer` holding the `File`), or on `/imports` use `page.locator('#import-files').setInputFiles(path)` (the `Import files` header button); either uploads at once and toasts `<file> received` (the file name links to the ingest run in the Imports list) → the ingest run spawns one `Encounter to Claim` child per report and completes (the import shows `Reports in progress` until they settle) → each child skips to a `Review updated PCR` task if its PCR number was already claimed, classifies the trip (`billing.classify-trip`; cancelled or no-contact trips raise a `Confirm no claim` task with `skip`/`claim`), reads the narrative with the local LLM, resolves its patient (exact match, auto-create, or a `Confirm patient` task in `billing-patients`) and its payers (directory name or learned alias, otherwise a `Match payer` task in `billing-payers` with the LLM suggestion preselected; linking teaches the alias) → work the `billing-review` queue, where the level of service, emergency flag and loaded miles are prefilled by `billing.suggest-service` for the trip type (`getByLabel('Level of service')`, `Emergency response`, `Loaded miles`) → approval prices the claim from `/fees` (dev seed: default schedule for A0425–A0434 and A0998); a claim missing something (for example no `eTimes.01` call time, so no date of service) raises `Claim needs attention` instead of being saved → the ingest completes with `count` and `summaries`, and each Encounter to Claim result has `tripType`, `patient` and `claimId`. Approval also opens a claim and starts a detached `billing.cycle-claim` run: it submits to each payer on the claim in order (submission is only recorded until a clearinghouse exists), waits 30 days per payer (timeout → `billing-followup` task), then sends 3 patient statements 30 days apart and finally a `billing-collections` task. Drive it from `/claims/<id>`: record responses/payments (`From`, `Paid (USD)`, `Adjusted (USD)`) or edit payer order (`Add a Payer`, `Move X up`, `Save Order`); both signal the cycle (`claim:<id>`) so history updates within a second. When the next payer is waiting for a claim the status alert offers `Create 837P file` and `Mark submitted`; `/claims?view=ready` lists every ready claim with checkboxes and `Create 837P file (n)`, and `/claims/files` lists past files. `/payers` holds the payer directory (`Add payer` / `Edit` open a dialog), `/fees` adds and edits fees in a dialog from `Add fee`, `/settings` is only the billing profile, `/reports` cards open reports that run immediately (period reports re-run with `Update`), and `/workflows?show=workflows|blocks|mine` filters the graph list. `/patients` searches by `Last name`, `First name` and `Birth date` (prefix match on names). Toasts are also kept in the bell (`Notifications`) next to the theme toggle, per user in localStorage. Reports need `eDisposition.32` (ALS/Critical Care) or `ePayment.50` (CMS service level) for a non-BLS suggestion, `eResponse.20/.21/.23` for miles and emergency, and a Primary `ePayment.InsuranceGroup` (or `ePayment.01` Medicare/Medicaid) for payer prices. Review tasks arrive as each child reaches them, so keep working the queues until no `Encounter to Claim` child is waiting; `hold` sends a report to `billing-holds` (release or void); wait for the queue row before checking it (`row.waitFor`), since the tasks table loads after the heading. Imported files and per-report JSON live in S3 under `imports/<tenant>/...`; run state only holds keys, while the `imports` and `import_reports` tables record each file and report. Check numbers on `/reports` (aging, monthly, payers, HCPCS) against the claims you created.

Override path: open a system graph such as `Map Charges` → `Override` (copies it into the tenant and opens draft v1) → select a Decision Table node to edit its rules as a form → `Save` → `Publish`. New runs that use the graph anywhere pick up the copy; the system graph shows `Overridden` with `Edit override`, and `Remove override` on the copy restores the built-in once no run uses it.

## Gotchas

- The pre-sign-in `GET /api/auth/me` 401 is expected (StrictMode runs it twice).
- Assert run state on the level-1 heading; child-run badges also say "Completed".
- Open sub-graphs with `node.dispatchEvent('dblclick')`: nodes can sit under the editor palette, which intercepts real pointer events. Drill-in state is in the URL (`?trail=` in the editor, `?at=` on runs), so `page.goBack()` walks back up.
- Tables are real tables from `md` up and labelled cards below it (headers become `sr-only`, so use a desktop viewport to click headers, or the `Sort by` select on phones). Sort, page and page size live in the URL (`sort`, `dir`, `page`, `pageSize`; a second table on a page prefixes them, e.g. `historySort`), so tests can open a view directly. Pagers show only the count until a list has more than 10 rows.
- `/runs` lists top-level runs only; reach `Encounter to Claim` runs through their `Ingest NEMSIS File` run.
- Node inputs in the editor are grouped by pin: scope with `page.getByRole('group', { name: /pinName/ })` before `getByLabel('Value', { exact: true })`.
- Wire pins with `node.locator('.react-flow__handle.source[data-handleid="exec"]').dragTo(...)`.
- Stopping a background task stops the `pnpm` wrapper, not its `node` child. Stop only your own processes by exact command line:
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { ($_.CommandLine -like '*--env-file=../../.env src/main.ts*' -and $_.CommandLine -notlike '*watch*') -or $_.CommandLine -like '*vite.js*--strictPort*' }`, then `Stop-Process -Id <those ids>`.
