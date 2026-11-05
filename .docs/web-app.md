# Web App

React app in `apps/web`, built with Vite. Pages live in `src/features/<area>`; shared building blocks in `src/shared`.

## Routing

- A small router (`src/shared/router.tsx`) keeps all app state in the URL.
- Agency pages live under `/agencies/:agencyId/...`. Code links to agency-relative paths (`/claims/123`); `navigate`, `Link` and `useLocation` add and strip the prefix, so features never handle agency IDs.
- Public pages: `/invitation?token=…` and `/password?token=…`.
- `App` → `AuthGate` (sign in) → `AgencyGate` (pick and load the agency's access) → `Workspace` (shell, navigation, pages).

## API calls

`createApi` rewrites `/api/...` to `/api/agencies/:agencyId/...` for the agency in the URL, except auth and the agency list. Feature clients call plain paths like `/api/claims`.

## Access in components

- `AccessProvider` holds the loaded `Access` (agency, organization, permissions).
- `useCan()('claims:update')` decides whether to show an action; navigation items declare the permission they need.
- The API enforces the same rules, so hidden is never the only protection.

## Live updates

`createLive(sseUrl, { agencyId })` opens `/events?agency=<id>` on the SSE app; pages reload their data on matching events and on reconnect.

## Pages

| Area                    | Paths                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claims and tasks        | `/claims`, `/claims/:id`, `/tasks/:id`                                                                                                              |
| Patients                | `/patients`, `/patients/:id`                                                                                                                        |
| Imports and payer files | `/imports`, `/imports/:id`, `/payer-files`, `/payer-files/:id`                                                                                      |
| Reports                 | `/reports`, `/reports/:id`, `/reports/:id/results`                                                                                                  |
| Workflows and runs      | `/workflows`, `/workflows/customized`, `/workflows/:id`, `/tables`, `/tables/:id`, `/runs`, `/runs/:id`                                             |
| Admin                   | `/payers`, `/facilities`, `/fees`, `/users`, `/users/invitations`, `/users/invite`, `/users/:id`, `/roles`, `/roles/new`, `/roles/:id`, `/settings` |

## Tasks and claims

Billers work tasks, not claims. `/tasks` is the work queue (by queue and assignee, Next Task moves through it). A task page (`/tasks/:id`) leads with **The Issue** (the task's one-line summary, else its first blocking claim issue; the issues or reasons; the workflow's warnings and notes; what is needed), then three tabs kept in `?tab=`: **Claim** (what is billed: a snapshot the API builds for every claim task, with patient, date of service, trip, payers with eligibility, charges and balance), **Encounter** (the source PCR as a readable summary over the raw XML) and **Patient** (the patient record and the insurance on the claim). Values the claim copied from the report that no longer match it (patient name, birth date, date of service, loaded miles, member IDs; `encounter-check.ts`) are flagged as "Encounter says …". **Workflow Details** (what the workflow passed, such as what supports a suggestion) sit under the tabs, open, with Hide. **Your Decision** sits beside the tabs on wide screens; on phones it comes before them when the task has fields and after them when it is a pure choice. Each option shows the hint its workflow gives (`hints` on `std.human.task`), else a fallback for the few outcomes that mean one thing everywhere. When the task's `prefill` is `current`, each edited field shows what it changed from (with Undo) and the edits are listed as current → new before the options. After a decision, a task the same run opens next (such as Fix Claim Data) is offered as **Up next on this claim**. Back returns to the tasks list, and the claim is a reference link.

The claim page (`/claims/:id`) is a read-only record. Its **Start Task** menu starts a claim task workflow through `POST /api/claims/:id/tasks`, waits for the run's first task (`GET /api/tasks?runId=`) and opens it; files for task fields upload through `POST /api/tasks/:id/files`.

## Workflow editor

- `?panel=settings` opens graph settings (paths, exit labels and descriptions, pins with labels and descriptions, variables); `?panel=compare` opens the compare panel of a copy; `?removed=shown` adds the base's removed nodes as ghosts. Documentation hints from `documentationIssues` show as a collapsible warning.
- On a copy the editor diffs the definition against `compare().copiedFrom` by node id (`override-diff.ts`) and passes `changes`, `changedEdges` and `removed` to the canvas; nodes whose subworkflow (`GET /graphs/nodes` `overridden`) or table (`GET /tables/effective`) is customized get the same outline.
- `custom` is the accent for anything an organization or agency changed; see [Overrides](overrides.md).

UI rules (tokens, spacing, controls, accessibility) are in the root README.
