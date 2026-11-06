# Getting Started

```sh
docker compose up -d       # Postgres, Redis, RustFS, SFTPGo, embeddings and completions (GPU)
pnpm install
pnpm db:migrate            # resets and creates the schema
pnpm db:seed:dev           # GNIS places, NEMSIS definitions, billing code sets, dev user, demo graphs, fees, payers
pnpm db:gnis               # optional: rebuild .seeds/data/gnis-places.tsv.gz from USGS (updated bimonthly)
pnpm db:nemsis             # optional: rebuild .seeds/data/nemsis-*.tsv.gz from the NEMSIS 3.5 schema
pnpm db:codes              # optional: rebuild .seeds/data/codes.tsv.gz (ICD-10-CM, ambulance HCPCS, modifiers, CARC, RARC, place of service)
pnpm dev                   # api, worker, sse, web and the mock clearinghouse
pnpm e2e                   # with the stack running: every area in the browser, suites in parallel (about 30s)
```

Copy `.env.example` to `.env` first, and have Docker running. The clearinghouse connection and the mock clearinghouse `pnpm dev` starts are in [Clearinghouse](clearinghouse.md). Run `pnpm check`, `pnpm typecheck`, and `pnpm test` before committing.

## Layout

| Path                    | Purpose                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api`              | Hono HTTP API: auth, graphs, runs, tasks, imports, payer files, claims, patients, notifications, reports                                                                                                                 |
| `apps/worker`           | Executes workflow runs from the pg-boss queue and implements billing store ports                                                                                                                                         |
| `apps/sse`              | Pushes live run, task, claim and import updates over Server-Sent Events (via Redis)                                                                                                                                      |
| `apps/web`              | React app: claims and their tasks, patients, imports, payer files, reports, workflows, runs, payers, fees, settings                                                                                                      |
| `libs/kernel`           | `graph` (workflow engine, expression language, standard nodes), `config` (validators), `live` (live event contract)                                                                                                      |
| `libs/platform`         | Domain-free I/O: `auth` (passwords, sessions), `clearinghouse` (SFTP batch, CORE real-time, sealed secrets), `inference` (embeddings, completions), `run-queue`, `storage` (S3)                                          |
| `libs/domain`           | `access` (permissions, built-in roles, grant rules), `billing` (matching, narrative reading, pricing, documentation, claim cycle, clearinghouse port, X12 837P/835/TA1/999/277CA/270/271/276/277), `nemsis` (XML, codes) |
| `libs/data`             | `db`: Postgres/Kysely client and schema                                                                                                                                                                                  |
| `libs/composition`      | `catalog`: the one node catalog of standard, NEMSIS, billing and model nodes                                                                                                                                             |
| `.migrations`, `.seeds` | Schema and seed data (billing graphs, GNIS place names, NEMSIS definitions, demo fees and payers)                                                                                                                        |
| `.e2e`                  | Browser tests of every area against a running stack (`pnpm e2e`); suites at the top, helpers in `shared/`                                                                                                                |
| `.docs`                 | Overviews of every area: architecture, access, engine, overrides, billing, clearinghouse, data model, web, testing                                                                                                       |

**Stack:** Node, TypeScript, pnpm workspaces, Postgres (Kysely, pgvector, pg_trgm), pg-boss, Redis, S3-compatible storage (RustFS), local models (text-embeddings-inference with Qwen3-Embedding, llama.cpp with Qwen3.5), Hono, valibot, React, Tailwind, React Flow, Biome.
