# Ugula

Ugula is a durable, visual workflow engine (think Unreal Blueprints meets n8n) with an EMS ambulance billing app built on top of it. Workflows are node graphs edited in the browser; billing is one set of nodes and graphs plugged into a general-purpose engine.

## How It Works

### The Workflow Engine

- **Graphs:** A workflow is a graph of nodes joined by **exec** wires (control flow) and **data** wires (typed values). Graphs are versioned and published; any graph can call another as a node.
- **Durable runs:** Runs persist their state in Postgres after every step, so they survive restarts. A run can suspend for days while it waits on a human task, a timer, a signal (e.g. "this claim changed"), or child workflows, then resume where it left off.
- **Human tasks:** Task nodes put work in named queues (patient review, PCR review, follow-ups, collections). Completing a task resumes its run on the chosen outcome.
- **Reliability:** Workers lease runs with fencing tokens, a sweeper recovers stalled runs, and transient failures retry while real faults stop the run for inspection and retry from the UI.
- **Separation:** The engine and its standard library (`libs/graph`) know nothing about billing. Billing nodes live in `libs/billing` and reach the database only through ports the worker implements.

### The Billing App

1. **Import:** NEMSIS 3.5 XML arrives by upload or SFTP and is split into one run per patient care report (PCR).
2. **Patient:** Each report is matched to an existing patient deterministically; uncertain matches go to a biller for review.
3. **Review & pricing:** Rules suggest the level of service (BLS, ALS1, ALS2, SCT) and loaded miles; a biller confirms them, and the claim is priced from HCPCS fee schedules (payer-specific prices first, then defaults).
4. **Claim cycle:** Each claim gets its own long-running workflow that works through its payers in order:
   - claims wait until they go out in an **837P batch** file, which billers generate on the Submissions page and upload to their clearinghouse;
   - a payer that hasn't answered in 30 days creates a follow-up task (resubmit, keep waiting, or move to the next payer);
   - payer responses are recorded against the claim;
   - once all payers are done, up to three **patient statements** (PDFs) go out 30 days apart;
   - an unpaid balance after that goes to collections review; claims close as paid, written off, or sent to collections.
5. **Settings:** The agency's billing profile, clearinghouse IDs, payer directory, and fee schedules drive the 837P files and statements.

## Layout

| Path | Purpose |
| --- | --- |
| `apps/api` | Hono HTTP API: auth, graphs, runs, tasks, imports, claims, submissions, settings |
| `apps/worker` | Executes workflow runs from the pg-boss queue and implements billing store ports |
| `apps/sse` | Pushes live run and task updates to the browser over Server-Sent Events (via Redis) |
| `apps/web` | React app: graph editor, runs, task queues, claims, submissions, fees, settings |
| `libs/graph` | Workflow engine, expression language, and standard node library |
| `libs/billing` | Billing domain: patient matching, pricing, claim cycle, statements, 837P generation |
| `libs/nemsis` | NEMSIS XML parsing |
| `libs/db`, `libs/jobs`, `libs/blobs`, `libs/events`, `libs/sessions`, `libs/config`, `libs/passwords` | Infrastructure: Postgres/Kysely, queues, S3 storage, events, sessions, config, hashing |
| `.migrations`, `.seeds` | Schema and seed data (demo billing graphs, fees, payers) |

**Stack:** Node, TypeScript, pnpm workspaces, Postgres (Kysely), pg-boss, Redis, S3-compatible storage (RustFS), Hono, valibot, React, Tailwind, React Flow, Biome.

## Getting Started

```sh
docker compose up -d       # Postgres, Redis, RustFS
pnpm install
pnpm db:migrate            # resets and creates the schema
pnpm db:seed:dev           # dev user, demo graphs, fees, payers
pnpm dev                   # api, worker, sse, web
```

Copy `.env.example` to `.env` first. Run `pnpm check`, `pnpm typecheck`, and `pnpm test` before committing.

---

# Engineering & Code Standards

This repository enforces strict, consistent standards across all applications, libraries, database schemas, tests, and user interfaces. Every change must adhere to these principles.

---

## 1. Core Engineering & Design Principles

- **Modern Idioms & Syntax:** Always use the latest language features, runtime capabilities, and modern conventions across TypeScript, SQL, HTML, and CSS. Never introduce legacy patterns, polyfills, or deprecated APIs.
- **Functional & Concise Style:**
  - Prefer **arrow functions** (`const fn = () => ...`) and higher-order factory functions over `function` declarations and `class` hierarchies.
  - Always use **`type` aliases over `interface`** declarations.
  - Write tight, high-signal code with concise variable names in local scopes (e.g., `i` over `index`, `tx` over `transaction`, `db` over `databaseInstance`) while keeping exported symbols and domain concepts clear and consistent.
- **SOLID, DRY & YAGNI—Without Over-Abstraction:**
  - Apply Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, and Dependency Inversion pragmatically.
  - Eliminate true duplication (DRY) and never build speculative features (YAGNI).
  - Avoid premature generalization, unnecessary wrapper layers, or complex indirection.
- **Dependency Injection & Composition Root:**
  - Pass external dependencies (database handles, Redis clients, queues, configuration, clocks, HTTP clients) explicitly as parameters or via factory functions.
  - Centralize environment variable parsing (`process.env`), service instantiation, and lifecycle wiring exclusively in the application's composition root (`src/main.ts`, `.migrations/migrate.ts`, `.seeds/seed.ts`). Never read `process.env` or instantiate singletons deep inside features or libraries.
- **Production-Ready Quality:** Write clean, performant, secure, and resilient code from the start. Validate boundaries, handle failure modes explicitly, and avoid temporary hacks.
- **Self-Documenting Code & Zero Comments:**
  - Express intent through precise naming, strict domain types, and straightforward control flow.
  - Do not write inline comments, docblocks, or explanatory notes unless documenting a non-obvious algorithmic invariant—which should be almost never. If code needs a comment, simplify the code.
- **Zero Dead Weight:** Never leave unused exports, dead branches, commented-out code, or superfluous dependencies in the codebase.
- **Uncompromising Consistency:** File names (`kebab-case`), type names (`PascalCase`), variable/function names (`camelCase`), and architectural patterns must remain uniform across the entire repository.
- **Continuous Verification:** Always run linting (`pnpm check`) and typechecking (`pnpm typecheck`) after making changes.
- **Conventional Commits:** Format all git commit messages according to the Conventional Commits specification (`<type>[optional scope]: <description>`, e.g., `feat(web): ...`, `fix(api): ...`, `refactor: ...`, `chore: ...`) using concise, imperative, lowercase subjects.

---

## 2. Monorepo & Screaming Architecture

- **Root-Only Dependency Management:**
  - All third-party `dependencies` and `devDependencies` are declared and versioned exclusively in the root `package.json`.
  - Workspace apps (`apps/*`) and libraries (`libs/*`) never declare external npm dependencies in their own `package.json`.
  - Apps only declare `"workspace:*"` references to internal `libs/*` in their `package.json` to explicitly control scope and access boundaries.
- **Application Conventions & Build Pipeline (`apps/*`):**
  - Every application uses `src/main.ts` as its entry point and composition root.
  - All applications (`web`, `api`, `sse`, `worker`) build with **Vite 8** directly into `/dist/{app}`.
  - `web` runs in development via `vite`; server and worker apps (`api`, `sse`, `worker`) run in development via `tsx`.
- **Screaming Architecture in Apps (`apps/*`):**
  - Organize applications by domain features (`src/features/<feature>/`) and cross-cutting application primitives (`src/shared/`).
  - Top-level directories must immediately communicate _what_ the system does rather than technical framework layers.
  - **Strict Feature Isolation:** Features must never import from sibling features. Any logic, type, or component needed by multiple features must be promoted to `src/shared/` or a workspace library (`libs/*`).
  - Maintain consistent file naming and structure across features (e.g., `routes.ts`, `schemas.ts`, `service.ts`, `queries.ts`).
- **Strict Library Boundaries (`libs/*`):**
  - Libraries are pure TypeScript source packages referenced directly by applications with no separate build step.
  - Libraries **cannot** import from other workspace libraries (`@ugula/*`); dependencies flow strictly one way from `apps/*` into `libs/*`.
  - Keep libraries stateless, dependency-injected, and decoupled from application-specific configuration.

---

## 3. Testing Standards

- **Mandatory Colocated Tests:** Every source file containing logic must have a colocated test file (`<name>.test.ts`) in the same directory.
- **Native Test Runner:** Write fast, isolated, deterministic tests using Node's built-in test runner (`node:test` and `node:assert/strict`).
- **Testable by Design:** Leverage dependency injection and pure functions so units and features can be tested cleanly without brittle module mocking.

---

## 4. Database & SQL

- **Naming Conventions:**
  - Use clear, descriptive, `snake_case` **plural** names for tables (e.g., `user_accounts`, `import_jobs`).
  - Use concise, unambiguous `snake_case` column names (`id`, `created_at`, `organization_id`, `is_active`) without redundant table-name prefixes.
- **Constraints & Indexing:**
  - Enforce data integrity at the database level using primary keys, foreign keys (with explicit `ON DELETE` / `ON UPDATE` behavior), `NOT NULL`, `UNIQUE`, and `CHECK` constraints.
  - Add indexes strictly for real query access patterns, foreign key lookups, and uniqueness constraints—never add speculative or redundant indexes.
- **Query Design:**
  - Write clean, modern, set-based SQL and Kysely queries.
  - Prefer CTEs, `RETURNING` clauses, `UPSERT` (`ON CONFLICT`), and window functions over multi-roundtrip application loops.
  - Select only the columns required; never use `SELECT *` in application queries.
- **Migrations & Seeds Workflow:**
  - Edit existing migration and seed files **in place** during development rather than appending corrective migrations, then reset, re-migrate, and re-seed the database (`pnpm db:migrate`, `pnpm db:seed:dev`).
  - Keep schema definitions and seed data deterministic and idempotent.

---

## 5. UI, Styling & Accessibility

- **Composable Primitives:** Build interfaces from small, single-responsibility UI primitives that compose cleanly into domain views.
- **Semantic Theme System:**
  - Support both **Light** and **Dark** themes seamlessly.
  - Standardize on five semantic intent tokens across the entire UI: `primary`, `success`, `info`, `warning`, and `danger`. Use these token names consistently across all variants, badges, alerts, and interactive states.
- **Tailwind-First Styling:**
  - Use sorted Tailwind CSS utility classes exclusively. Custom CSS is prohibited unless required for root theme variables or browser-level resets.
  - Never include duplicate, overridden, or conflicting Tailwind utility classes on an element.
  - Maintain a consistent spacing, sizing, border-radius, and elevation scale across all views.
- **Clean Typography:** Establish clear visual hierarchy through consistent font weights, line heights, tracking, and semantic text colors.
- **Minimal Semantic HTML5+:**
  - Use the leanest possible DOM tree with native semantic elements (`<main>`, `<nav>`, `<section>`, `<article>`, `<dialog>`, `<button>`, `<fieldset>`). Avoid unnecessary wrapper `<div>`s.
- **Interactive Affordances:**
  - All interactive and clickable elements (`<button>`, `<a>`, clickable cards/rows, toggles) must explicitly include `cursor-pointer` when enabled and clear disabled states when inactive.
  - Incorporate smooth, subtle transitions and micro-animations for state changes, hover/focus feedback, and layout transitions.
- **Mobile-First & Fully Responsive:** Design layouts starting from mobile viewports upward, ensuring fluid usability across mobile, tablet, and desktop breakpoints.
- **WCAG Compliance:** Meet WCAG AA accessibility standards at minimum—maintain proper color contrast ratios, visible focus rings, keyboard navigability, and accurate ARIA attributes where native semantics do not suffice.

---

## 6. AI Collaboration Standards

- **Strict Adherence:** Follow every rule in this document without exception.
- **Minimal, High-Signal Responses:** Keep explanations brief and direct to conserve tokens. Let the code speak for itself.
- **First-Time Precision:** Understand the context, verify assumptions, and execute changes accurately on the first pass.
- **Absolute Consistency:** Match existing conventions, naming, and architectural patterns across every file touched.
