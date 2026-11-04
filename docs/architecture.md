# Architecture

Ugula is a durable visual workflow engine with an EMS ambulance billing app built on it. The engine knows nothing about billing; billing is a set of nodes, models and graphs plugged into it.

## Apps

| App                          | Role                                                                                                                            | Entry                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `apps/api`                   | Hono HTTP API. Signs users in, checks agency access and permissions, serves every page's data, starts runs and completes tasks. | `apps/api/src/main.ts`    |
| `apps/worker`                | Leases runs from the pg-boss queue and executes them; implements the billing store ports; polls the clearinghouse.              | `apps/worker/src/main.ts` |
| `apps/sse`                   | Streams live events (runs, tasks, claims, imports) to browsers, one stream per agency.                                          | `apps/sse/src/main.ts`    |
| `apps/web`                   | React app: claims, tasks, patients, imports, payer files, reports, workflows, runs, payers, fees, users, roles, settings.       | `apps/web/src/main.ts`    |
| `.dev/mock-clearinghouse.ts` | Dev-only SFTP server that answers 837P files like a clearinghouse.                                                              | `pnpm dev:clearinghouse`  |

## Library layers

Libraries live in `libs/<layer>/<name>` and only import layers below them. `libs/boundaries.test.ts` enforces this.

```
composition ──► domain ──► kernel
data ─────────► domain, platform, kernel
platform ─────► kernel
```

| Layer         | Libs                                        | Holds                                                                                           |
| ------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `kernel`      | `graph`, `config`, `live`                   | The engine, expression language, standard nodes, env validators, live event contract            |
| `platform`    | `auth`, `inference`, `run-queue`, `storage` | Passwords, sessions, tokens; embeddings and completions; the run queue; S3 blobs                |
| `domain`      | `access`, `billing`, `nemsis`               | Permissions and built-in roles; billing models, rules, nodes and X12; NEMSIS parsing and models |
| `data`        | `db`                                        | Kysely schema, graph version resolution, run pinning, payer file posting                        |
| `composition` | `catalog`                                   | The one node catalog every app shares                                                           |

The web app may only import `kernel`, `domain` and `composition`.

## A request

1. The browser calls `/api/...`. The web API client rewrites agency calls to `/api/agencies/:agencyId/...` using the agency in the page URL.
2. `requireAuth` reads the session cookie (Redis) and loads `{ userId, email }`.
3. `requireAgencyAccess` checks the user may open that agency and loads their permissions (`AgencyAccess`).
4. `guardMethods` / `requirePermission` reject anything the role does not allow.
5. The feature's service runs queries scoped by `access.agencyId`.

See [Tenancy and Access](tenancy-and-access.md).

## A run

1. Something starts a workflow: an import, a payer file, a user, or a parent run.
2. `startRun` inserts the run and **pins** every graph version it depends on (`workflow_run_graphs`), resolving overrides for the run's agency.
3. A worker leases the run, builds an engine from the pinned definitions and executes nodes, saving state after each side effect.
4. The run suspends on tasks, timers, signals or child runs and resumes later on any worker.
5. Child runs inherit the parent's pinned versions, so one claim never mixes versions.

See [Workflow Engine](workflow-engine.md) and [Overrides](overrides.md).

## Infrastructure

Postgres (pgvector, pg_trgm), Redis, pg-boss, S3-compatible storage (RustFS), SFTPGo for agency uploads, local models for embeddings and completions. `compose.yml` starts them all.
