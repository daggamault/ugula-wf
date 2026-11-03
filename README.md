# Ugula

Ugula is a durable, visual workflow engine (think Unreal Blueprints meets n8n) with an EMS ambulance billing app built on top of it. Workflows are node graphs edited in the browser; billing is one set of nodes and graphs plugged into a general-purpose engine.

## How It Works

### The Workflow Engine

- **Graphs:** A workflow is a graph of nodes joined by **exec** wires (control flow) and **data** wires (typed values). Graphs are versioned and published; any graph can call another as a node, and a `Get Input` node reads a graph input next to the nodes that use it. The editor lays graphs out by their flow (loops never widen them) and can rearrange any graph.
- **Durable runs:** Runs persist their state in Postgres after every node with side effects (and every few pure steps), so they survive restarts without repeating work. A run can suspend for days while it waits on a human task, a timer, a signal (e.g. "this claim changed"), or child workflows, then resume where it left off. Signals are counted, so a run that was busy when one arrived still sees it when it next waits.
- **Starting runs:** A published workflow can be run from the browser with a form for its inputs. File inputs (`{ bucket, key }`) are an upload button: the file is stored under the agency's import area and the run receives its reference.
- **Human tasks:** Task nodes create tasks of a type (patient matching, PCR review, follow-ups, collections). Every run that works a claim is linked to it (`claim_runs`), so each task and stuck run shows on its claim; completing a task resumes its run on the chosen outcome.
- **Reliability:** Workers lease runs with fencing tokens, a sweeper recovers stalled runs, and transient failures retry while real faults stop the run for inspection and retry from the UI.
- **Scaling:** Workers scale horizontally. Postgres LISTEN/NOTIFY wakes an idle worker the moment a run is queued. Each worker claims runs only while it has a free slot (`WORKFLOW_CONCURRENCY`) and its event loop and memory are under their limits; over a limit it finishes what it holds and claims nothing new until load falls back. Language-model calls share one cluster-wide limit (`COMPLETIONS_CONCURRENCY`), held as expiring leases in Redis, so adding workers never overloads the model server; a run that finds every lease taken gives up its slot and retries on a short timer. Task completions and signals are picked up before bulk work, and each import runs at most `WORKFLOW_CONCURRENCY` of its reports at once across the cluster, so one large file never takes every worker.
- **Separation:** The engine and its standard library (`libs/kernel/graph`) know nothing about billing. NEMSIS and billing nodes and models live in `libs/domain/nemsis` and `libs/domain/billing` and reach the database only through ports the worker implements.

### Subworkflows

Workflows are built from small, general nodes, so agencies can change billing logic without code:

- **Typed models:** a NEMSIS patient care report, its sections (patient, times, payment, scene, situation, disposition, medications and more), the claim, and the 837P claim are named models. Each model gets a **Break** node (one labelled output per field, such as `Last name · ePatient.02`) and a **Make** node (one input per field).
- **Tables:** a **Decision Table** checks rules top to bottom (is, is one of, starts with, at least, is empty and so on) and outputs the first matching rule's values, plus every rule that held as reasons. A **Lookup Table** maps codes to values. Both are edited as forms in the workflow editor.
- **Lists and logic:** Where, Pluck Field, Reshape Items, Make List, Sort By Field, Coalesce, Select, math and text nodes.
- **Capability nodes** do what a graph cannot: read and split NEMSIS files, match patients and payers, read narratives with the local model, price lines from fee schedules, save claims, run the claim cycle and render statements.

**Overrides:** every built-in graph can be overridden by an agency. Override copies the graph into the agency's workspace. Once the copy is published, every workflow that uses that graph uses the copy for that agency, as long as it keeps the same inputs, outputs and exits. Each run records which versions it uses when it starts, so publishing or removing an override never changes a run that has already started.

### The Billing App

`billing.ingest-nemsis` starts one **Encounter to Claim** run per report. That run is made of smaller graphs, each one an override point:

1. **Import:** NEMSIS 3.4 or 3.5 XML arrives by upload or SFTP and is split into one run per patient care report (PCR), read as a typed report, and `Open Draft Claim` opens its claim as a **Draft** straight away, before the patient is known, so every task the PCR needs is worked on that claim. NEMSIS records cities as USGS GNIS feature codes; the import names them from a `gnis_places` table the base seed loads, and keeps the code alongside. Element names and code descriptions come from `nemsis_elements` and `nemsis_codes`, built from the official 3.5 schema, so a report shows `2205001 Emergency Response (Primary Response Area)` rather than a bare code.
2. **Duplicates:** A PCR number is claimed once per agency. A re-imported or corrected report becomes a revision of its existing claim and goes to a biller instead of opening a second claim.
3. **Trip type:** `Classify Trip` decides from the dispositions (`eDisposition.12`, or `.27`, `.28` and `.30` in 3.5) and the type of service whether the trip is an emergency, scheduled, treat-no-transport, refusal or no-claim trip. No-claim trips ask a biller before their draft is voided.
4. **Patient:** `Demographics From PCR` maps the report patient, which is matched to an existing patient only on the same last name, birth date and first name or nickname. One exact match is used and no close match creates the patient. Likely matches (similar names found by trigram search and Jaro-Winkler, birth date typos) go to a `Confirm patient` task that only asks the biller to use the preselected candidate or create a new patient from the report. A report missing the name or birth date asks for just those first. Once the patient is known, `Assign Patient` sets it on the draft claim.
5. **Payers:** `Coverages From PCR` maps the insurances, or Medicare or Medicaid from the payment method. Their names link to the payer directory by name or by a name a biller already matched. Other names are compared with the directory by embedding (pgvector), the local language model suggests the likely payer, and a biller confirms it once; that name then links automatically.
6. **Service:** the local language model lists the medication doses and CMS ALS2 procedures the narrative documents. `Suggest Service` runs the graph for the trip type (`Emergency Trip`, `Scheduled Trip`, `Treat, No Transport`, `Refusal`), built on `Level of Service` and `Loaded Miles` decision tables over the level of care, CMS service level, the ALS assessment, coded IV/IO medications, coded ALS2 procedures (SNOMED CT), response mode and odometers. `Review PCR` shows the biller the complaint, symptom, vitals, coded procedures and what the report documents for billing, and warns when no vitals support medical necessity. A biller confirms it, or holds the report (then releases or voids it).
7. **Claim:** `Map Charges` turns the confirmed service into HCPCS lines (a base rate by trip type, level and emergency, A0998 for no transport, and A0425 mileage in tenths of a mile), which are priced from fee schedules (the primary payer's prices first, then defaults). `Map Claim`, `Trip Details` and `Documentation From PCR` fill the claim, including diagnoses, origin/destination modifiers and documentation: the release-for-billing signature (signed, a Medicare exception because the patient could not sign, refused or missing), the physician certification statement, the CMS transport reason (reported, else from the reason for the destination), ambulance conditions, prior authorization, weight and trip times. A claim cannot go to a payer without a billing signature or a documented exception, a transport reason on transports, or a certification on scheduled non-emergency Medicare trips; old certifications, out-of-order times and nearing or passed filing limits are warnings. `Validate Claim` keeps an incomplete claim in Draft and sends it to a biller; a valid one is saved and moves to **Needs review**. A held or incomplete PCR that a biller voids closes its draft as **Void**.
8. **Claim cycle:** Each claim gets its own long-running workflow that sleeps until a claim change or a deadline, and works through its payers in order. Its `Claim Step` node decides the next step from the claim's ledger and records it as the claim's status, so the status a biller filters by is always the step the claim is on. The waits and the number of statements are inputs of `Claim Step`.
   - **Needs review:** before each payer, a `Review claim` task makes a biller check and approve the claim; nothing goes to a clearinghouse unreviewed, including resubmissions;
   - **Ready to submit:** as soon as the review is approved, the payer cycle files the claim on its own as an **837P file** (`Prepare 837P Claim`, `Map 837P Claim`, `File 837P Claim`), logs it submitted, and `Send 837P to Clearinghouse` uploads it to the clearinghouse SFTP server (without a connection, the file waits on the claim for the biller to upload). The `Map 837P Claim` graph maps the claim (subscriber, payer, ambulance conditions, modifiers, service lines), and the file only serializes what it maps. When the file cannot be created (an incomplete billing profile, blocking claim data, an incomplete mapping or used-up control numbers), a `Claim could not be filed` task says why and lets the biller try again, fix the data (which sends it back to review), skip the payer or mark it submitted another way;
   - **Submitted:** a 999 or 277CA rejection sends the claim back to review with the payer's reason; a payer that hasn't answered in 30 days creates a follow-up task (**Needs follow-up**: resubmit, keep waiting, or move to the next payer);
   - **Reconcile payment:** a payer payment posted against the claim that leaves a balance opens a reconcile task (continue to the next payer or the patient, or write off the rest); a payment that settles the claim closes it as paid;
   - **Patient balance:** once all payers are done, up to three patient statements (PDFs) go out 30 days apart;
   - **Balance review:** an unpaid balance after that goes to a biller; claims close as **Paid**, **Written off**, **Sent to collections** or **Void**.
9. **Payer files:** the worker polls the clearinghouse SFTP download folders, routes each file to the agency it is addressed to (ISA08 is the agency's submitter ID) and starts `Receive Payer File` for it, which applies it and starts `Review Payer File Line` (a task on the claim) for every line a biller has to look at. Each claim lists the payer files that touched it. An 835 posts each claim's payment, contractual adjustments and reason codes (patient responsibility stays on the balance), matched by claim number and payer; a 999 accepts or rejects every claim in its 837P file; a 277CA accepts or rejects single claims; a 271 records whether each payer says the coverage is active, and an inactive coverage blocks billing that payer. Check Eligibility on a claim downloads a 270 for its payers. Every line keeps its outcome, unclear lines (reversals, unknown claims, payers not on the claim) go to a biller, and the same file is never applied twice.
10. **Admin:** Payers (the directory, with each clearinghouse payer ID, its filing limit and the report names it has learned), Fees, and Settings (the agency's billing profile and clearinghouse IDs) drive the 837P files and statements.
11. **Working it:** Billers work from Claims: each row shows the task the claim is waiting on with a Work Task action, the list filters by task type and assignee. A claim's page lists its open tasks, and a task page names its claim and returns to it. Claims and patients get sequential numbers (`claims.number`, `patients.number`, identity columns shared across agencies), and the encounter number is the PCR number. Claims has a collapsible filter form for first and last name, birth date, any of the three numbers, and status (open claims by default), all in SQL; each claim has Overview, Claim data and History tabs, and its Files list the source encounter (NEMSIS XML), its 837P files and statements. Patients searches by name and birth date; each import lists what every PCR in the file became. New tasks, stuck runs and every message a biller sees are kept in the notification bell, stored per tenant and user so they follow the biller across devices.
12. **Reports:** Every import, report, claim line, coverage, diagnosis and ledger event is a relational row, so A/R aging, monthly collections, payer performance and HCPCS charges are plain SQL. Reports lists them; each one opens an options page (dates of service, where the report uses them) and then a results page that pages at 100 rows, prints the current page as a black and gray document, and downloads as CSV.

## Layout

| Path                    | Purpose                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`              | Hono HTTP API: auth, graphs, runs, tasks, imports, payer files, claims, patients, notifications, reports                            |
| `apps/worker`           | Executes workflow runs from the pg-boss queue and implements billing store ports                                                    |
| `apps/sse`              | Pushes live run, task, claim and import updates over Server-Sent Events (via Redis)                                                 |
| `apps/web`              | React app: claims and their tasks, patients, imports, payer files, reports, workflows, runs, payers, fees, settings                 |
| `libs/kernel`           | `graph` (workflow engine, expression language, standard nodes), `config` (validators), `live` (live event contract)                 |
| `libs/platform`         | Domain-free I/O: `auth` (passwords, sessions), `inference` (embeddings, completions), `run-queue`, `storage` (S3)                   |
| `libs/domain`           | `billing` (matching, narrative reading, pricing, documentation, claim cycle, X12 837P/835/999/277CA/270/271), `nemsis` (XML, codes) |
| `libs/data`             | `db`: Postgres/Kysely client and schema                                                                                             |
| `libs/composition`      | `catalog`: the one node catalog of standard, NEMSIS, billing and model nodes                                                        |
| `.migrations`, `.seeds` | Schema and seed data (billing graphs, GNIS place names, NEMSIS definitions, demo fees and payers)                                   |
| `.e2e`                  | Browser tests of every area against a running stack (`pnpm e2e`); suites at the top, helpers in `shared/`                           |

**Stack:** Node, TypeScript, pnpm workspaces, Postgres (Kysely, pgvector, pg_trgm), pg-boss, Redis, S3-compatible storage (RustFS), local models (text-embeddings-inference with Qwen3-Embedding, llama.cpp with Qwen3.5), Hono, valibot, React, Tailwind, React Flow, Biome.

## Getting Started

```sh
docker compose up -d       # Postgres, Redis, RustFS, SFTPGo, embeddings and completions (GPU)
pnpm install
pnpm db:migrate            # resets and creates the schema
pnpm db:seed:dev           # GNIS places, NEMSIS definitions, dev user, demo graphs, fees, payers
pnpm db:gnis               # optional: rebuild .seeds/data/gnis-places.tsv.gz from USGS (updated bimonthly)
pnpm db:nemsis             # optional: rebuild .seeds/data/nemsis-*.tsv.gz from the NEMSIS 3.5 schema
pnpm dev                   # api, worker, sse, web and the mock clearinghouse
pnpm e2e                   # with the stack running: every area in the browser, suites in parallel (about 30s)
```

Copy `.env.example` to `.env` first. Run `pnpm check`, `pnpm typecheck`, and `pnpm test` before committing.

### Clearinghouse connection

The worker reads the clearinghouse SFTP connection from `.env`; leave `CLEARINGHOUSE_SFTP_HOST` empty to turn the exchange off. Pointing it at a real clearinghouse is a settings change:

| Setting                             | Mock (default)                              | TriZetto                               | Waystar                          |
| ----------------------------------- | ------------------------------------------- | -------------------------------------- | -------------------------------- |
| `CLEARINGHOUSE_SFTP_HOST` / `_PORT` | `localhost` / `2223`                        | from your TriZetto setup               | from your Waystar setup          |
| `CLEARINGHOUSE_UPLOAD_PATH`         | `/inbound`                                  | the upload folder they give you        | the outbound (write-only) folder |
| `CLEARINGHOUSE_DOWNLOAD_PATHS`      | `/outbound/999,/outbound/277,/outbound/835` | one folder each for 999, 277CA and 835 | the inbound folder               |
| `CLEARINGHOUSE_FILE_EXTENSION`      | `.txt`                                      | `.txt`                                 | `.CLP`                           |
| `CLEARINGHOUSE_AFTER_DOWNLOAD`      | `delete`                                    | `delete`                               | `delete` or `keep`               |

Response files are recognized by content (ISA/GS/ST), not by name, and each agency's billing profile submitter ID must be the ID the clearinghouse addresses its responses to. Confirm folder names, extensions and IDs with the clearinghouse during enrollment.

### Mock clearinghouse

`.dev/mock-clearinghouse.ts` is a dev-only, in-memory SFTP server that answers 837P files like a clearinghouse. `pnpm dev` starts it (`pnpm dev:clearinghouse` alone) on `CLEARINGHOUSE_SFTP_HOST`:`CLEARINGHOUSE_SFTP_PORT` (localhost:2223 in `.env.example`) for `CLEARINGHOUSE_SFTP_USERNAME` / `CLEARINGHOUSE_SFTP_PASSWORD`. Files live in memory and are gone on restart; the host key is new on every start.

- Upload 837P files to `/inbound` (files ending in `.part`, `.tmp` or `.filepart` wait until renamed). About 2s later the file is picked up and removed.
- `/outbound/999/<name>.999` acknowledges the group (AK1 = the 837 GS06); a file that is not a readable 837P gets a rejected 999 (`AK9*R`).
- `/outbound/277/<name>.277` has one status per claim (TRN = CLM01): accepted, or rejected with "Invalid member ID" when the subscriber member ID starts with `REJECT`.
- `/outbound/835/<name>.835` follows after `CLEARINGHOUSE_REMIT_DELAY_SECONDS` (default 20) for accepted claims, one transaction per payer: 80% of the charge paid, the rest a CO-45.

`<name>` is the uploaded name without its extension. The responses come from `respond()` in `@ugula/billing/mock`, which also has the 999/277CA/835/271 builders the e2e suites use.

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
- **Trunk-Based Git:** Always commit and push directly to `main`. Never create branches; keep each commit small, green (`pnpm check`, `pnpm typecheck`, `pnpm test`) and self-contained.

---

## 2. Monorepo & Screaming Architecture

- **Root-Only Dependency Management:**
  - All third-party `dependencies` and `devDependencies` are declared and versioned exclusively in the root `package.json`.
  - Workspace apps (`apps/*`) and libraries (`libs/<layer>/*`) never declare external npm dependencies in their own `package.json`.
  - Apps and libraries declare a `"workspace:*"` reference to exactly the internal libs they import, and nothing else, so each `package.json` states its boundaries.
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
  - Libraries live in layer folders, `libs/<layer>/<name>`, and import only libs in the layers their layer allows. A lib never imports a lib in its own layer, so nothing points sideways or upward:
    - **`kernel`** (`graph`, `config`, `live`): pure, runtime-agnostic foundations and contracts. Imports no lib.
    - **`platform`** (`auth`, `inference`, `run-queue`, `storage`): I/O adapters with no domain knowledge. Imports `kernel`.
    - **`domain`** (`billing`, `nemsis`): the business models, rules and nodes every feature builds on. No I/O; it reaches the outside world through ports (store types) that apps implement. Imports `kernel`.
    - **`data`** (`db`): persistence over domain types, so an enum has one definition shared by code, Kysely types and migration `CHECK` constraints. Imports `domain`, `platform` and `kernel`.
    - **`composition`** (`catalog`): assembles several domains into one thing all apps share. Imports `domain` and `kernel`.
  - Apps sit on top of every layer; `web` runs in the browser and imports only `kernel`, `domain` and `composition`.
  - Domain models cross features: when two features need the same thing, move it down instead of across, to `domain` for a business concept, `data` for shared persistence, `platform` for I/O plumbing, or the app's `src/shared/` for app mechanics.
  - `libs/boundaries.test.ts` enforces the layers, that every package declares exactly the `@ugula/*` libs it imports as `"workspace:*"`, and that relative imports never leave their package. Adding a lib to a layer folder needs no configuration.
  - Dependencies flow one way from `apps/*` into `libs/*`; a lib never imports an app.
- **Nodes:** Define nodes with `pureNode`, `actionNode` or `branchNode` and `pin()` from `@ugula/graph`. Inputs are typed from their pins, and the engine checks required inputs, input and output types and exec outputs, so node code never re-checks them by hand; it only checks domain rules.
  - Keep libraries stateless, dependency-injected, and decoupled from application-specific configuration.

---

## 3. Testing Standards

- **Mandatory Colocated Tests:** Every source file containing logic must have a colocated test file (`<name>.test.ts`) in the same directory. Migrations, seeds and the `.e2e` suite have none; `.e2e` covers how the workflows behave.
- **Native Test Runner:** Write fast, isolated, deterministic tests using Node's built-in test runner (`node:test` and `node:assert/strict`).
- **Test Kits:** Libraries ship their fakes from a `/testing` entry (`@ugula/db/testing`, `@ugula/graph/testing`, `@ugula/billing/testing`) instead of each test rebuilding them. Test nodes with `invokeNode`, which applies the same input, output and exit checks as the engine.
- **End-to-End:** `.e2e` drives the real app in a headless browser (Edge by default, `E2E_BROWSER_CHANNEL=chrome` otherwise) with synthetic NEMSIS and X12 fixtures only: billing from import to payment, claims, tasks, patients, workflows, runs, imports, payer files, reports and admin. Each suite runs in its own process with unique data, so suites run in parallel; every step waits at most `E2E_STEP_MS` (15s by default). The completions service must be up, or narrative reads wait out their retries. Never commit real patient data.
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
- **Design Scale:** Theme tokens live in `apps/web/src/main.css` `@theme`; fix a primitive in `shared/ui` before patching a call site.
  - **Radius:** controls (buttons, inputs, selects, icon buttons, menu and nav items) `rounded-lg`; containers (panels, cards, alerts, dialogs, popovers, toasts, table frames, documents, empty states) `rounded-xl`; badges, pills, counts and avatars `rounded-full`.
  - **Surfaces:** page `bg-canvas`; containers `bg-surface border border-border`, flat; floating layers (dialogs, menus, dropdowns, popovers, tooltips, toasts, the notification panel) `bg-surface border-border shadow-lg`; tinted status surfaces (alerts, badges) `bg-{intent}/10 border-{intent}/30`.
  - **Shadows:** `shadow-lg` on floating layers only. Buttons, cards, panels, badges, inputs, tabs and backdrops carry no shadow.
  - **Hover:** things with their own surface (outline buttons, inputs, clickable cards) go to opaque `bg-surface-hover`; ghost controls (icon buttons, nav items, tab pills, menu items) go to `bg-surface-fg/6` with `text-surface-fg-muted` becoming `text-surface-fg`. Never hover to a translucent tint of the parent's intent. Selected nav and menu items are `bg-primary/10 text-primary`; the selected tab pill is solid primary.
  - **Focus:** every interactive element uses `interactiveClasses` from `shared/ui/interactive.ts` for its primary outline ring.
  - **Motion:** colors and hover `transition duration-150 ease-out`; overlays enter and leave with fade plus scale or slide over 200ms via `open:`/`starting:`/`data-*` variants; layout movement (collapse, indicators) 300ms; `active:scale-[0.98]` press feedback on buttons only; reduced motion turns it all off.
  - **Spacing:** pages `p-4 sm:p-6 lg:p-10 gap-6`; section panels `p-5 gap-4`; forms `gap-y-5` between fields and `gap-x-4` between columns; inline control groups and icon-to-text `gap-2`; list and table cells `px-4 py-3`.
  - **Control sizes:** every button, input and select is `h-10` (md); icon buttons are `size-9`; each is larger under `pointer-coarse`. The `h-8` (sm) size is only for genuinely dense spots: pagination, inline editors inside cards, and the notifications panel.
  - **Typography:** page title `text-2xl font-extrabold tracking-tight`; section title `text-base font-bold`; body `text-sm`; labels `text-sm font-medium`; meta and help `text-xs` or `text-sm text-surface-fg-muted`; table headers `text-xs font-semibold uppercase tracking-wide text-surface-fg-muted`; numbers `tabular-nums`.
  - **Colors:** semantic tokens only (`canvas`, `surface`, `surface-hover`, `surface-fg`, `surface-fg-muted`, `border`, `primary`, `success`, `info`, `warning`, `on-warning`, `danger`). The printable report document is the one black-and-gray exception.
  - **Vertical alignment:** icons beside text are `items-center` at `size-4` for `text-sm` and `size-3.5` for `text-xs`, with no `mt-*` nudges; beside multi-line text the icon sits in an `h-5 flex items-center` box on the first line. Controls in a row share one height; forms align fields and buttons with `items-end`, action groups with `items-center`. Table cells are `align-middle`, and two-line cells stack with `flex flex-col gap-0.5`. Badges and counts use `text-xs/5`. Page and section headers center their actions against the title block; back, close and dismiss buttons sit on the title's first line. Alerts center a single line with its actions; multi-line alerts keep the icon on the first line and center the actions.
- **Clean Typography:** Establish clear visual hierarchy through consistent font weights, line heights, tracking, and semantic text colors.
- **Minimal Semantic HTML5+:**
  - Use the leanest possible DOM tree with native semantic elements (`<main>`, `<nav>`, `<section>`, `<article>`, `<dialog>`, `<button>`, `<fieldset>`). Avoid unnecessary wrapper `<div>`s.
- **Interactive Affordances:**
  - All interactive and clickable elements (`<button>`, `<a>`, clickable cards/rows, toggles) must explicitly include `cursor-pointer` when enabled and clear disabled states when inactive.
  - Incorporate smooth, subtle transitions and micro-animations for state changes, hover/focus feedback, and layout transitions.
- **One Way to Do Each Thing:**
  - Every table row's actions are icon buttons in a last, hidden-label `Actions` column: work task (list), open (chevron right), edit (pencil), delete (trash, danger), run (play). The row's name is plain text, never a link. Each action's label names the row.
  - Hover feedback belongs only on things that react to a click. Rows, cards and panels that do nothing stay still.
  - Page and form actions are text buttons with a leading icon (`Save`, `Add Fee`, `Run Report`). Icon-only buttons are reserved for table row actions and chrome that every app shares: close, dismiss, back, menu, theme, sign out and reorder arrows. Each one carries a tooltip.
  - Every page and section has a title and one plain sentence saying what it is for. Field hints are the only other help text.
  - Labels are Title Case; sentences stay sentence case.
  - Editing happens on its own page, never in a dialog, so all app state lives in the URL. Dialogs only confirm or choose, and destructive confirmations are danger themed.
  - Lists search, sort and page on the server, and keep every column left-aligned.
  - Reuse the existing shared components and patterns before writing new ones.
- **Mobile-First & Fully Responsive:** Design layouts starting from mobile viewports upward, ensuring fluid usability across mobile, tablet, and desktop breakpoints.
- **WCAG Compliance:** Meet WCAG AA accessibility standards at minimum—maintain proper color contrast ratios, visible focus rings, keyboard navigability, and accurate ARIA attributes where native semantics do not suffice.

---

## 6. AI Collaboration Standards

- **Strict Adherence:** Follow every rule in this document without exception.
- **Minimal, High-Signal Responses:** Keep explanations brief and direct to conserve tokens. Let the code speak for itself.
- **First-Time Precision:** Understand the context, verify assumptions, and execute changes accurately on the first pass.
- **Absolute Consistency:** Match existing conventions, naming, and architectural patterns across every file touched.
