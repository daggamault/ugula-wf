# Getting Started

```sh
docker compose up -d       # Postgres, Redis, RustFS, SFTPGo, embeddings and completions (GPU)
pnpm install
pnpm db:reset              # schema and reference data from a cached template, billing graphs, dev user, agencies, fees, payers
pnpm dev                   # api, worker, sse, web and the mock clearinghouse
```

Copy `.env.example` to `.env` first, and have Docker running. The clearinghouse connection and the mock clearinghouse `pnpm dev` starts are in [Clearinghouse](clearinghouse.md). Run `pnpm check`, `pnpm typecheck`, and `pnpm test` before committing, and `pnpm seed:check` after changing a seed graph or table: it validates every billing and dev graph and table without a database, as `db:seed` does before publishing.

## Layout

| Path                    | Purpose                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api`              | Hono HTTP API: auth, graphs, runs, tasks, imports, payer files, claims, patients, notifications, reports                                                                                                                 |
| `apps/worker`           | Executes workflow runs from the pg-boss queue and implements billing store ports                                                                                                                                         |
| `apps/sse`              | Pushes live run, task, claim and import updates over Server-Sent Events (via Redis)                                                                                                                                      |
| `apps/web`              | React app: claims and their tasks, patients, imports, payer files, reports, workflows, runs, payers, fees, settings                                                                                                      |
| `apps/chouse`           | Mock clearinghouse: dev-only Waystar-style SFTP and CORE real-time server; never built or deployed                                                                                                                       |
| `libs/kernel`           | `graph` (workflow engine, expression language, standard nodes), `config` (validators), `live` (live event contract)                                                                                                      |
| `libs/platform`         | Domain-free I/O: `auth` (passwords, sessions), `clearinghouse` (SFTP batch, CORE real-time, sealed secrets), `inference` (embeddings, completions), `run-queue`, `storage` (S3)                                          |
| `libs/domain`           | `access` (permissions, built-in roles, grant rules), `billing` (matching, narrative reading, pricing, documentation, claim cycle, clearinghouse port, X12 837P/835/TA1/999/277CA/270/271/276/277), `nemsis` (XML, codes) |
| `libs/data`             | `db`: Postgres/Kysely client and schema                                                                                                                                                                                  |
| `libs/composition`      | `catalog`: the one node catalog of standard, NEMSIS, billing and model nodes                                                                                                                                             |
| `.migrations`, `.seeds` | Schema and seed data (billing graphs, GNIS place names, NEMSIS definitions, dev agencies' fees and payers)                                                                                                               |
| `.xmls`                 | Synthetic NEMSIS files for manual testing, one per billing scenario                                                                                                                                                      |
| `.docs`                 | Overviews of every area: architecture, access, engine, overrides, billing, clearinghouse, data model, web, testing                                                                                                       |

**Stack:** Node, TypeScript, pnpm workspaces, Postgres (Kysely, pgvector, pg_trgm), pg-boss, Redis, S3-compatible storage (RustFS), local models (text-embeddings-inference with Qwen3-Embedding, llama.cpp with Qwen3.5), Hono, valibot, React, Tailwind, React Flow, Biome.
