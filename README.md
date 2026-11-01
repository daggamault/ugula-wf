# Ugula

Ugula is a durable, visual workflow engine (think Unreal Blueprints meets n8n) with an EMS ambulance billing app built on top of it. Workflows are node graphs edited in the browser; billing is one set of nodes and graphs plugged into a general-purpose engine.

## How It Works

### The Workflow Engine

- **Graphs:** A workflow is a graph of nodes joined by **exec** wires (control flow) and **data** wires (typed values). Graphs are versioned and published; any graph can call another as a node.
- **Durable runs:** Runs persist their state in Postgres after every step, so they survive restarts. A run can suspend for days while it waits on a human task, a timer, a signal (e.g. "this claim changed"), or child workflows, then resume where it left off. Signals are counted, so a run that was busy when one arrived still sees it when it next waits.
- **Human tasks:** Task nodes create tasks of a type (patient matching, PCR review, follow-ups, collections). Billers see one task list filtered by type and assignee; completing a task resumes its run on the chosen outcome.
- **Reliability:** Workers lease runs with fencing tokens, a sweeper recovers stalled runs, and transient failures retry while real faults stop the run for inspection and retry from the UI.
- **Separation:** The engine and its standard library (`libs/graph`) know nothing about billing. NEMSIS and billing nodes and models live in `libs/nemsis` and `libs/billing` and reach the database only through ports the worker implements.

### Building Blocks

Workflows are built from small, general nodes, so agencies can change billing logic without code:

- **Typed models:** a NEMSIS patient care report, its sections (patient, times, payment, scene, situation, disposition, medications and more), the claim, and the 837P claim are named models. Each model gets a **Break** node (one labelled output per field, such as `Last name · ePatient.02`) and a **Make** node (one input per field).
- **Tables:** a **Decision Table** checks rules top to bottom (is, is one of, starts with, at least, is empty and so on) and outputs the first matching rule's values, plus every rule that held as reasons. A **Lookup Table** maps codes to values. Both are edited as forms in the workflow editor.
- **Lists and logic:** Where, Pluck Field, Reshape Items, Make List, Sort By Field, Coalesce, Select, math and text nodes.
- **Capability nodes** do what a graph cannot: read and split NEMSIS files, match patients and payers, read narratives with the local model, price lines from fee schedules, save claims, run the claim cycle and render statements.

**Overrides:** every built-in graph can be overridden by an agency. Override copies the graph into the agency's workspace. Once the copy is published, every workflow that uses that graph uses the copy for that agency, as long as it keeps the same inputs, outputs and exits. Each run records which versions it uses when it starts, so publishing or removing an override never changes a run that has already started.

### The Billing App

`billing.ingest-nemsis` starts one **Encounter to Claim** run per report. That run is made of smaller graphs, each one an override point:

1. **Import:** NEMSIS 3.4 or 3.5 XML arrives by upload or SFTP and is split into one run per patient care report (PCR), read as a typed report. NEMSIS records cities as USGS GNIS feature codes; the import names them from a `gnis_places` table the base seed loads, and keeps the code alongside.
2. **Duplicates:** A PCR number is claimed once per agency. A re-imported or corrected report becomes a revision of its existing claim and goes to a biller instead of opening a second claim.
3. **Trip type:** `Classify Trip` decides from the dispositions (`eDisposition.12`, or `.27`, `.28` and `.30` in 3.5) and the type of service whether the trip is an emergency, scheduled, treat-no-transport, refusal or no-claim trip. No-claim trips ask a biller before they are skipped.
4. **Patient:** `Demographics From PCR` maps the report patient, which is matched to an existing patient only on the same last name, birth date and first name or nickname. Likely matches (similar names found by trigram search and Jaro-Winkler, birth date typos) go to a biller for review.
5. **Payers:** `Coverages From PCR` maps the insurances, or Medicare or Medicaid from the payment method. Their names link to the payer directory by name or by a name a biller already matched. Other names are compared with the directory by embedding (pgvector), the local language model suggests the likely payer, and a biller confirms it once; that name then links automatically.
6. **Service:** the local language model lists the medication doses and CMS ALS2 procedures the narrative documents. `Suggest Service` runs the graph for the trip type (`Emergency Trip`, `Scheduled Trip`, `Treat, No Transport`, `Refusal`), built on `Level of Service` and `Loaded Miles` decision tables over the level of care, CMS service level, coded IV/IO medications, response mode and odometers. A biller confirms it, or holds the report (then releases or voids it).
7. **Claim:** `Map Charges` turns the confirmed service into HCPCS lines (a base rate by trip type, level and emergency, A0998 for no transport, and A0425 mileage in tenths of a mile), which are priced from fee schedules (the primary payer's prices first, then defaults). `Map Claim` and `Trip Details` fill the claim, including diagnoses and origin/destination modifiers. `Validate Claim` sends an incomplete claim to a biller instead of saving it.
8. **Claim cycle:** Each claim gets its own long-running workflow that sleeps until a claim change or a deadline, and works through its payers in order. The waits and the number of statements are inputs of its `Claim Step` node.
   - claims wait until they go out in an **837P batch** file, which billers create from the `Ready to submit` view on Claims (or from a single claim) and upload to their clearinghouse; past files are under `Claims → 837P files`. Each claim is mapped onto an 837P claim by the `Map 837P Claim` graph (subscriber, payer, ambulance conditions, modifiers, service lines), and the batch only serializes what it maps;
   - a payer that hasn't answered in 30 days creates a follow-up task (resubmit, keep waiting, or move to the next payer);
   - payer responses are recorded against the claim;
   - once all payers are done, up to three **patient statements** (PDFs) go out 30 days apart;
   - an unpaid balance after that goes to collections review; claims close as paid, written off, or sent to collections.
9. **Settings:** The agency's billing profile, clearinghouse IDs, payer directory (with the report names it has learned), and fee schedules drive the 837P files and statements.
10. **Reports:** Every import, report, claim line, coverage, diagnosis and ledger event is a relational row, so A/R aging, monthly collections, payer performance and HCPCS charges are plain SQL, viewable on the Reports page and downloadable as CSV.

## Layout

| Path                                                                                                  | Purpose                                                                                     |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `apps/api`                                                                                            | Hono HTTP API: auth, graphs, runs, tasks, imports, claims, submissions, reports, settings   |
| `apps/worker`                                                                                         | Executes workflow runs from the pg-boss queue and implements billing store ports            |
| `apps/sse`                                                                                            | Pushes live run, task, claim and import updates over Server-Sent Events (via Redis)         |
| `apps/web`                                                                                            | React app: graph editor, runs, tasks, imports, claims, submissions, reports, fees, settings |
| `libs/graph`                                                                                          | Workflow engine, expression language, and standard node library                             |
| `libs/billing`                                                                                        | Billing domain: patient and payer matching, narrative reading, pricing, claim cycle, 837P   |
| `libs/inference`                                                                                      | Clients for the local embeddings and structured-completions services                        |
| `libs/nemsis`                                                                                         | NEMSIS XML parsing                                                                          |
| `libs/db`, `libs/jobs`, `libs/blobs`, `libs/events`, `libs/sessions`, `libs/config`, `libs/passwords` | Infrastructure: Postgres/Kysely, queues, S3 storage, events, sessions, config, hashing      |
| `.migrations`, `.seeds`                                                                               | Schema and seed data (billing graphs, GNIS place names, demo fees and payers)               |

**Stack:** Node, TypeScript, pnpm workspaces, Postgres (Kysely, pgvector, pg_trgm), pg-boss, Redis, S3-compatible storage (RustFS), local models (text-embeddings-inference with Qwen3-Embedding, llama.cpp with Qwen3.5), Hono, valibot, React, Tailwind, React Flow, Biome.

## Getting Started

```sh
docker compose up -d       # Postgres, Redis, RustFS, SFTPGo, embeddings and completions (GPU)
pnpm install
pnpm db:migrate            # resets and creates the schema
pnpm db:seed:dev           # GNIS places, dev user, demo graphs, fees, payers
pnpm db:gnis               # optional: rebuild .seeds/data/gnis-places.tsv.gz from USGS (updated bimonthly)
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
- **Trunk-Based Git:** Commit directly to `main`. Do not create feature, fix or release branches; keep each commit small, green (`pnpm check`, `pnpm typecheck`, `pnpm test`) and self-contained instead.

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
- **One Way to Do Each Thing:**
  - Each destination has exactly one link: in tables, the row's name is the link. Never add an "Open" button or icon that goes to the same place.
  - Hover feedback belongs only on things that react to a click. Rows, cards and panels that do nothing stay still.
  - Actions are text buttons with a leading icon (`Edit`, `Delete`, `Run`). Icon-only buttons are reserved for chrome that every app shares: close, dismiss, back, menu, theme, sign out and reorder arrows. Each one carries a tooltip.
  - Every page and section has a title and one plain sentence saying what it is for. Field hints are the only other help text.
- **Mobile-First & Fully Responsive:** Design layouts starting from mobile viewports upward, ensuring fluid usability across mobile, tablet, and desktop breakpoints.
- **WCAG Compliance:** Meet WCAG AA accessibility standards at minimum—maintain proper color contrast ratios, visible focus rings, keyboard navigability, and accurate ARIA attributes where native semantics do not suffice.

---

## 6. AI Collaboration Standards

- **Strict Adherence:** Follow every rule in this document without exception.
- **Minimal, High-Signal Responses:** Keep explanations brief and direct to conserve tokens. Let the code speak for itself.
- **First-Time Precision:** Understand the context, verify assumptions, and execute changes accurately on the first pass.
- **Absolute Consistency:** Match existing conventions, naming, and architectural patterns across every file touched.
