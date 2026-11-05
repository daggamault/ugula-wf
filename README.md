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

**Overrides:** every built-in graph can be overridden for a whole organization or for one agency. Override copies the graph and records the version it came from; once the copy is published, every workflow that uses that graph uses it, agency copy first, then the organization's, then the built-in graph. A copy must keep the same inputs, outputs and exits (its contract); when a built-in graph changes its contract, older copies stop applying until they are rebased. Compare shows a copy against the version it came from and the newest base. Each run pins the versions it uses when it starts, and child runs reuse their parent's, so publishing or removing an override never changes a run that has already started. See [docs/overrides.md](docs/overrides.md).

### Organizations, Agencies and Access

An organization (an EMS service or a billing company) has one or more agencies, and each agency owns its claims, patients, payers, fees and tasks. Users belong to one organization; owners see every agency, and everyone else has a role in each agency they work in. Roles are custom per agency, built from `resource:action` permissions, and seeded as Admin, Billing Manager, Biller and Viewer. Admins invite users with a one-time link; nobody can grant permissions they do not hold or remove an agency's last user admin. Agency pages live under `/agencies/:agencyId`, the agency picker in the sidebar switches agencies, and every API route checks membership and permissions. See [docs/tenancy-and-access.md](docs/tenancy-and-access.md).


### The Billing App

`billing.ingest-nemsis` starts one **Encounter to Claim** run per report. That run is made of smaller graphs, each one an override point: **stages** sequence the work, every billing decision is a small **rule** graph or a keyed **table** that returns its reasons, and each stage has an empty **Agency Rule** slot. Code nodes only read and write. See [docs/billing-workflows.md](docs/billing-workflows.md) for the catalog.

1. **Import:** NEMSIS 3.4 or 3.5 XML arrives by upload or SFTP and is split into one run per patient care report (PCR), read as a typed report, and `Open Draft Claim` opens its claim as a **Draft** straight away, before the patient is known, so every task the PCR needs is worked on that claim. NEMSIS records cities as USGS GNIS feature codes; the import names them from a `gnis_places` table the base seed loads, and keeps the code alongside. Element names and code descriptions come from `nemsis_elements` and `nemsis_codes`, built from the official 3.5 schema, so a report shows `2205001 Emergency Response (Primary Response Area)` rather than a bare code. `Map Encounter Facts` then turns the report into one typed snapshot, the **Encounter Facts** (trip, locations, patient, clinical, documentation, reported coverages), that every later rule reads instead of NEMSIS sections.
2. **Duplicates:** A PCR number is claimed once per agency. A re-imported or corrected report becomes a revision of its existing claim and goes to a biller instead of opening a second claim.
3. **Trip type:** `Classify Trip` (the Trip Type table) decides from the dispositions (`eDisposition.12`, or `.27`, `.28` and `.30` in 3.5) and the type of service whether the trip is an emergency, scheduled, treat-no-transport, refusal or no-claim trip. Cancelled calls, calls with no patient contact and non-patient services (standby, rescue, crew or organ transport and the like) where nobody was transported are no-claim trips, which ask a biller before their draft is voided.
4. **Patient:** `Demographics From PCR` maps the report patient, which is matched to an existing patient only on the same last name, birth date and first name or nickname. One exact match is used and no close match creates the patient. Likely matches (similar names found by trigram search and Jaro-Winkler, birth date typos) go to a `Confirm patient` task that only asks the biller to use the preselected candidate or create a new patient from the report. A report missing the name or birth date asks for just those first. Once the patient is known, `Assign Patient` sets it on the draft claim.
5. **Payers:** `Determine Payers` takes the insurances `Coverages From PCR` maps, or Medicare or Medicaid from the payment method. Their names link to the payer directory by name or by a name a biller already matched. Other names are compared with the directory by embedding (pgvector), the local language model suggests the likely payer, and a biller confirms it once; that name then links automatically. `Coordination Order` bills them in the priority the report gives (Coverage Priority table).
6. **Service:** the local language model lists the medication doses and CMS ALS2 procedures the narrative documents, each with the words that show it; a finding the narrative does not contain, or a procedure its quote does not name, is dropped, and IV solutions (saline, Ringer's, dextrose) are never medications. `Determine Service` runs the rule for the trip type (`Emergency Trip`, `Scheduled Trip`, `Treat, No Transport`, `Refusal`), built on the `Level of Service`, `Emergency Status` and `Loaded Miles` rules and tables over the level of care, CMS service level, the ALS assessment, coded IV/IO medications other than IV solutions (RxNorm), coded ALS2 procedures (SNOMED CT), response mode and odometers. SCT is only for interfacility transports, and a trip is an emergency when the unit responded immediately (emergent, including when later downgraded), so an emergent interfacility transfer is billed as one. `Review PCR` shows the biller the complaint, symptom, vitals, coded procedures and what the report documents for billing, and warns when no vitals support medical necessity. A biller confirms it, or holds the report (then releases or voids it).
7. **Claim:** `Assign Charges` turns the confirmed service into HCPCS lines (`Base Rate Code`: a base rate by trip type, level and emergency, A0998 for no transport; `Mileage Lines`: A0425 loaded miles rounded up to the tenth, or to the whole mile from 100 miles), priced by `Price Precedence` (a price set for the claim, else the primary payer's fee schedule, else the default). `Assign Claim Properties` fills the claim from the facts, including `Assign Diagnoses`, `Origin/Destination Modifiers`, the `Transport Reason` and documentation: the release-for-billing signature (signed, a Medicare exception because the patient could not sign, refused or missing), the physician certification statement, the CMS transport reason (reported, else from the reason for the destination), ambulance conditions, prior authorization, weight and trip times. `Check Claim` runs the check rules (`Check Billing Signature`, `Check Physician Certification`, `Check Transport Reason`, `Check Mileage`, `Check Timely Filing` and more): a claim cannot go to a payer without a billing signature or a documented exception, a transport reason on transports, or a certification on scheduled non-emergency Medicare trips; old certifications, out-of-order times and nearing or passed filing limits are warnings. Each issue has a code whose severity (blocking, warning or off) comes from the agency's **Check Severity** table. An incomplete claim stays in Draft and goes to a biller; edits that change the trip type, service, miles or payers reprice it (`Reprice Triggers`); a valid one is saved and moves to **Needs review**. A held or incomplete PCR that a biller voids closes its draft as **Void**.
8. **Claim cycle:** Each claim gets its own long-running workflow that sleeps until a claim change or a deadline, and works through its payers in order. `Read Claim Ledger` reads where the claim stands, the `Next Claim Step` rule decides the next step (Claim Steps table) under the agency's **Claim Policy** table (waits, statements, collections threshold, write-off limit and review, per kind of payer), and `Record Claim Step` records it as the claim's status, so the status a biller filters by is always the step the claim is on. Review and submission run `Check Claim` first.
   - **Needs review:** before each payer, a `Review claim` task makes a biller check and approve the claim; nothing goes to a clearinghouse unreviewed, including resubmissions;
   - **Ready to submit:** as soon as the review is approved, the payer cycle files the claim on its own as an **837P file** (`Prepare 837P Claim`, `Map 837P Claim`, `File 837P Claim`), logs it submitted, and `Send 837P to Clearinghouse` uploads it through the agency's clearinghouse connection (without one, the file waits on the claim for the biller to upload). The `Map 837P Claim` graph maps the claim (subscriber, payer, ambulance conditions, modifiers, service lines), and the file only serializes what it maps. When the file cannot be created (an incomplete billing profile, blocking claim data, an incomplete mapping or used-up control numbers), a `Claim could not be filed` task says why and lets the biller try again, fix the data (which sends it back to review), skip the payer or mark it submitted another way;
   - **Submitted:** a TA1, 999 or 277CA rejection sends the claim back to review with the reason (a TA1 envelope rejection also asks for the clearinghouse setup to be fixed); a payer that hasn't answered in 30 days gets a claim status request (276, real time or batch) and a follow-up task showing its latest status (**Needs follow-up**: resubmit, keep waiting, or move to the next payer);
   - **Reconcile payment:** a payer payment posted against the claim that leaves a balance opens a reconcile task (continue to the next payer or the patient, or write off the rest); a payment that settles the claim closes it as paid; a denial records its reason codes but keeps the balance, so a biller reconciles it;
   - **Patient balance:** once all payers are done, up to three patient statements (PDFs) go out 30 days apart;
   - **Balance review:** an unpaid balance after that goes to a biller; claims close as **Paid**, **Written off**, **Sent to collections** or **Void**.
9. **Payer files:** the worker polls the clearinghouse SFTP download folders, routes each file to the agency it is addressed to (ISA08 is the agency's submitter ID) and starts `Receive Payer File` for it (a file uploaded by hand on Payer Files starts the same workflow), which applies it and starts `Review Payer File Line` (a task on the claim) for every line a biller has to look at. Each claim lists the payer files that touched it. An 835 posts each claim's payment, contractual adjustments and reason codes (patient responsibility stays on the balance), matched by claim number and payer, as `Route Remittance` decides (`Classify Adjustments` with the Adjustment Classes table, then the Remittance Routing table; reversals, takebacks and payers not on the claim go to a biller unposted); a TA1 rejects the envelope of its 837P file; a 999 accepts or rejects every claim in its 837P file; a 277CA accepts or rejects single claims; a 277 claim status is logged in each claim's History; a 271 records whether each payer says the coverage is active (an inactive coverage blocks billing that payer, and a Medicare answer naming a Medicare Advantage plan asks a biller to bill that plan instead). `Check Eligibility` runs when a claim's payers are saved and from the claim page: a real-time 270 when the connection supports it, else a batch 270; the claim page can also download the 270. Every line keeps its outcome, unclear lines (reversals, unknown claims, payers not on the claim) go to a biller, and the same file is never applied twice.
10. **Admin:** Users and Roles, Payers (the directory, with each clearinghouse payer ID, its filing limit and the report names it has learned), Fees, and Settings (the agency's billing profile, clearinghouse IDs and clearinghouse connection) drive the 837P files and statements.
11. **Working it:** Billers work from Claims, which has two tabs. **Queue** is the work queue: every open claim, paged and sortable, oldest waiting task first, each row showing the task the claim is waiting on (and who that task is assigned to; claims themselves are never assigned) with a Work Task action. **Search** finds any claim, open or closed, by first and last name, birth date or any of the three numbers, all in SQL. A claim's page lists its open tasks, and a task page names its claim and returns to it. Claims and patients get sequential numbers (`claims.number`, `patients.number`, identity columns shared across agencies), and the encounter number is the PCR number. Each claim has Overview, Claim data and History tabs, and its Files list the source encounter (NEMSIS XML), its 837P files and statements. Patients searches by name and birth date; each import lists what every PCR in the file became. New tasks, stuck runs and every message a biller sees are kept in the notification bell, stored per agency and user so they follow the biller across devices.
12. **Reports:** Every import, report, claim line, coverage, diagnosis and ledger event is a relational row, so A/R aging, monthly collections, payer performance and HCPCS charges are plain SQL. Reports lists them; each one opens an options page (dates of service, where the report uses them) and then a results page that pages at 100 rows, prints the current page as a black and gray document, and downloads as CSV.

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
| `docs`                  | Overviews of every area: architecture, access, engine, overrides, billing, clearinghouse, data model, web, testing                                                                                                       |

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

Each agency can set its own clearinghouse connection in Settings (Clearinghouse Connection: Waystar, the mock or another SFTP clearinghouse, with SFTP account, folders, extensions and an optional CAQH CORE real-time URL). Its password is encrypted with `CLEARINGHOUSE_SECRET_KEY` (32 random bytes, base64; the api and worker both need it) and never sent back to the browser. Agencies without one use the worker's `CLEARINGHOUSE_*` connection from `.env`, the dev default; leave `CLEARINGHOUSE_SFTP_HOST` empty for no default. Pointing at a real clearinghouse is a settings change:

| Setting                                | Mock (default)                        | TriZetto                               | Waystar                       |
| -------------------------------------- | ------------------------------------- | -------------------------------------- | ----------------------------- |
| `CLEARINGHOUSE_SFTP_HOST` / `_PORT`    | `localhost` / `2223`                  | from your TriZetto setup               | `sshftp.waystar.com` / `22`   |
| `CLEARINGHOUSE_UPLOAD_PATH`            | `/upload`                             | the upload folder they give you        | `/upload` (write-only)        |
| `CLEARINGHOUSE_DOWNLOAD_PATHS`         | `/download`                           | one folder each for 999, 277CA and 835 | `/download`                   |
| `CLEARINGHOUSE_FILE_EXTENSION` (837P)  | `.CLP`                                | `.txt`                                 | `.CLP`                        |
| `CLEARINGHOUSE_ELIGIBILITY_EXTENSION`  | `.ELG`                                | `.txt`                                 | `.ELG`                        |
| `CLEARINGHOUSE_CLAIM_STATUS_EXTENSION` | `.CLS`                                | `.txt`                                 | `.CLS` (assumed; confirm)     |
| `CLEARINGHOUSE_AFTER_DOWNLOAD`         | `delete`                              | `delete`                               | `delete` or `keep`            |
| `CLEARINGHOUSE_REALTIME_URL`           | `http://localhost:2224/core/realtime` | empty (batch only)                     | from Waystar (not public yet) |

Response files are recognized by content (ISA/GS/ST, or a TA1 segment), not by name, and each agency's billing profile submitter ID must be the ID the clearinghouse addresses its responses to (its Receiver ID is `WAYSTAR` for Waystar). The worker polls every distinct connection once. Confirm folder names, extensions, IDs and real-time credentials with the clearinghouse during enrollment. See [docs/clearinghouse.md](docs/clearinghouse.md).

### Mock clearinghouse

`.dev/mock-clearinghouse.ts` is a dev-only, in-memory clearinghouse that follows Waystar's conventions, so moving to Waystar is a settings change. `pnpm dev` starts it (`pnpm dev:clearinghouse` alone): SFTP on `CLEARINGHOUSE_SFTP_HOST`:`CLEARINGHOUSE_SFTP_PORT` for `CLEARINGHOUSE_SFTP_USERNAME` / `CLEARINGHOUSE_SFTP_PASSWORD`, and CORE real-time eligibility and claim status on `CLEARINGHOUSE_REALTIME_PORT`. Files and claim states live in memory and are gone on restart; the host key is new on every start.

- Upload to the write-only `/upload` folder: 837P files as `<name>.CLP`, batch 270s as `<name>.ELG`, batch 276s as `<name>.CLS`, with no other periods in the name (`.part`, `.tmp` and `.filepart` uploads wait until renamed). About 2s later the file is picked up and removed.
- Answers arrive in `/download` as `<ISA06>_<type>_<yyyyMMddHHmmss>_<seq>.<ext>` and are recognized by content:
  - an interchange not addressed to `WAYSTAR` or `ZIRMED` (ISA08) gets a rejected `.TA1` and nothing else;
  - `.999` acknowledges the group (AK1 = the 837 GS06); an unreadable 837P gets a rejected 999 (`AK9*R`);
  - `.277` (277CA) has one status per claim (TRN = CLM01): accepted, or rejected with "Invalid member ID" when the subscriber member ID starts with `REJECT`;
  - `.835` follows after `CLEARINGHOUSE_REMIT_DELAY_SECONDS` (default 20) for accepted claims, one transaction per payer, 80% paid and the rest a CO-45, except payers listed in `CLEARINGHOUSE_ERA_UNENROLLED` (no ERA enrollment, so no 835);
  - `.271` answers each 270 inquiry: active coverage, inactive when the member ID starts with `INACTIVE`, and naming a Medicare Advantage plan when it starts with `ADVANTAGE`;
  - `.277` (claim status, 005010X212) answers each 276: in process (A2) for an accepted claim, paid (F1) once its 835 went out, rejected (A3), or not found (A4) for a claim it never saw.
- `POST /core/realtime` takes a CAQH CORE multipart envelope (Basic auth, `PayloadType` `X12_270_Request_005010X279A1` or `X12_276_Request_005010X212`) and returns the 271 or 277 in the same envelope.

The answers come from `@ugula/billing/mock-waystar` (built on `@ugula/billing/mock`, which also has the 999/277CA/835/271/277 builders the e2e suites use).

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
- **End-to-End:** `.e2e` drives the real app in a headless browser (Edge by default, `E2E_BROWSER_CHANNEL=chrome` otherwise) with synthetic NEMSIS and X12 fixtures only: billing from import to payment, claims, tasks, patients, workflows, runs, imports, payer files, reports and admin. One NEMSIS fixture per billing scenario in `.e2e/fixtures` (trip types, levels of service, mileage, modifiers, documentation, coverage, NEMSIS 3.4 and 3.5, multi-report files and corrected reports) is checked down to the 837P it files. Each fixture has its own PCR number (`PCR-1001` and up; a corrected report shares its original's), so the fixtures can also be uploaded by hand, and the suites swap in a unique number per run. Each suite runs in its own process with unique data, so suites run in parallel; every step waits at most `E2E_STEP_MS` (15s by default) and every workflow stage at most `E2E_FLOW_MS` (5 minutes by default, as all suites share the local model). The completions service must be up, or narrative reads wait out their retries. Never commit real patient data.
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
  - **Colors:** semantic tokens only (`canvas`, `surface`, `surface-hover`, `surface-fg`, `surface-fg-muted`, `border`, `primary`, `success`, `info`, `warning`, `on-warning`, `danger`, `custom`). The printable report document is the one black-and-gray exception.
  - **Custom:** `custom` (fuchsia) means "this organization or agency changed this" and nothing else: changed nodes and wires, overridden subworkflows and tables, changed properties and their badges (`border-custom`, `bg-custom/10 border-custom/30 text-custom`). It is never a status or an action color.
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
