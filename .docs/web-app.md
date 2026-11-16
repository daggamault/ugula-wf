# Web App

React app in `apps/web`, built with Vite. Pages live in `src/features/<area>`; shared building blocks in `src/shared`.

## Routing

- A small router (`src/shared/router.tsx`) keeps all app state in the URL.
- Agency pages live under `/agencies/:agencyId/...`. Code links to agency-relative paths (`/claims/123`); `navigate`, `Link` and `useLocation` add and strip the prefix, so features never handle agency IDs.
- Editing pages call `useUnsavedChanges(dirty)` while their form differs from what was loaded. Leaving for another page (links, `navigate`, back and forward) then asks to discard the changes in the one `UnsavedChangesDialog` the workspace mounts, and reload or close asks the browser to confirm. Query-only changes (panels, tabs) pass unless the page names the params that identify it (`['version']` in the workflow and table editors). Navigations after a successful save or delete pass `{ force: true }`.
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

Billers work tasks, not claims. `/tasks` is the work queue (by queue and assignee, Next Task moves through it). A task page (`/tasks/:id`) leads with **The Issue**: the task's one-line summary (else its first blocking claim issue) as the card's sentence, the issues or reasons, the workflow's warnings and notes, what is needed, and **Your Decision** inside the same card, so the problem and its answer sit together at the top on every screen size. Each option is a sentence saying what it does (`hints` on `std.human.task`, else a fallback for the few outcomes that mean one thing everywhere) above its button, with the options separated by "or"; a field only one outcome requires (such as the classification Make Claim needs) sits with that option, and the other fields sit above them all. When the task's `prefill` is `current`, each edited field shows what it changed from (with Undo) and the edits are listed as current → new before the options. After a decision, Done replaces the options, and a task the same run opens next (such as Fix Claim Data) is offered as **Up next on this claim**. Below the card, tabs kept in `?tab=` show everything read only, each only when the task has that data: **Claim** (the whole claim from `/api/claims/:id`: summary, charges, claim data, documentation and payers; every code shows as Description (code) from the `codes` table, and while the claim is open the API runs Map 837P Claim for the payer billed next so each charge shows the modifiers and the claim data the place of service that payer is billed), **Encounter** (the source PCR as a readable summary, every NEMSIS, GNIS and ICD-10 code with its meaning, over the raw XML), **Patient** (the patient the claim bills for) and **Workflow** (what the workflow passed, such as what supports a suggestion). Values the claim copied from the report that no longer match it (patient name, birth date, date of service, loaded miles, member IDs; `encounter-check.ts`) are flagged on the Claim and Patient tabs. A task with no claim, report or patient shows **Workflow Details** instead of the tabs. Back returns to the tasks list, and the claim is a reference link.

The claim page (`/claims/:id`) is a read-only record. Its **Start Task** menu starts a claim task workflow through `POST /api/claims/:id/tasks`, waits for the run's first task (`GET /api/tasks?runId=`) and opens it; files for task fields upload through `POST /api/tasks/:id/files`. A task field with a `codeSet` (such as the claim diagnoses, `icd10cm`) is a code picker: one searchable list that queries `GET /api/codes` by code or description, suggests the codes of its `codeList` (a NEMSIS pick list, such as `impression` for diagnoses) before anything is typed, and shows every option as Description (code); a list field shows the chosen codes in billing order with Move Up and Move Down.

## Workflow editor

- `?panel=signature` opens **Inputs and Outputs** on an agency's custom graph (paths, exit labels and descriptions, pins with labels and descriptions, variables); built-in graphs and their copies do not offer it; `?panel=compare` opens the compare panel of a copy; `?removed=shown` adds the base's removed nodes as ghosts. Documentation hints from `documentationIssues` show as a collapsible warning.
- On a copy the editor diffs the definition against `compare().copiedFrom` by node id (`override-diff.ts`) and passes `changes`, `changedEdges` and `removed` to the canvas; nodes whose subworkflow (`GET /graphs/nodes` `overridden`) or table (`GET /tables/effective`) is customized get the same outline.
- `custom` is the accent for anything an agency changed; see [Overrides](overrides.md).
- The node inspector reads top to bottom: what the node does, Inputs (wired ones read "From {Node} · {Pin}"), Settings, Outputs and Then (exit docs from the node definition), then collapsed **Rename and Note** and **Advanced** (retry in seconds, settings as JSON).
- Settings never start as JSON. `SETTINGS_EDITORS` (`node-settings.tsx`) maps node types to dedicated editors: tables, formulas (`std.expr` and the list formula nodes, checked live with `exprProblem`, inputs from `freeIdentifiers`, functions from `exprFunctionDocs`), Human Task, Make and Break Record fields, the workflow nodes (a picker over published workflows and versions), Constant, To Code, variables and Get Input. Every other node gets `ConfigForm`, built from its valibot config schema (`config-schema.ts`): text, numbers with bounds, booleans, picklists and literal unions, lists, records, value types (`TypePicker`), any value and field choices; a shape it cannot read falls back to JSON for that setting only.
- `ValueField` edits records field by field and lists row by row; only open records and `any` values (behind **Kind of Value: JSON**) are JSON. Expression bindings are checked against the graph's variables, the only names the engine gives them.

UI rules (tokens, spacing, controls, accessibility) are in [Standards](standards.md).

Adding a facility (Settings, Facilities) can fill its name, address, phone and kind from the CMS hospital list: **Fill From CMS Hospital** searches `GET /api/facilities/hospitals` by name.
