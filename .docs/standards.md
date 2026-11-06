# Standards

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
    - **`platform`** (`auth`, `clearinghouse`, `inference`, `run-queue`, `storage`): I/O adapters with no domain knowledge. Imports `kernel`.
    - **`domain`** (`access`, `billing`, `nemsis`): the business models, rules and nodes every feature builds on. No I/O; it reaches the outside world through ports (store types) that apps implement. Imports `kernel`.
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
- **End-to-End:** `.e2e` drives the real app at `E2E_WEB_URL` (`http://localhost:3000` by default) in a headless browser (Edge by default, `E2E_BROWSER_CHANNEL=chrome` otherwise) with synthetic NEMSIS and X12 fixtures only: billing from import to payment, claims, tasks, patients, workflows, runs, imports, payer files, reports and admin. One NEMSIS fixture per billing scenario in `.e2e/fixtures` (classifications, levels of service, mileage, modifiers, documentation, coverage, NEMSIS 3.4 and 3.5, multi-report files and corrected reports) is checked down to the 837P it files. Each fixture has its own PCR number (`PCR-1001` and up; a corrected report shares its original's), so the fixtures can also be uploaded by hand, and the suites swap in a unique number per run. Each suite runs in its own process with unique data, so suites run in parallel; every step waits at most `E2E_STEP_MS` (15s by default) and every workflow stage at most `E2E_FLOW_MS` (5 minutes by default, as all suites share the local model). The completions service must be up, or narrative reads wait out their retries. Never commit real patient data.
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

The goal is a clean, intuitive UI that just works and explains itself. When a rule below gets in the way of that, the goal wins.

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
  - **Control sizes:** every button, input and select is `h-10` (md); icon buttons are `size-9`; each is larger under `pointer-coarse`. The `h-8` (sm) size is only for genuinely dense spots: pagination, inline editors inside cards, and the notifications panel. The sidebar agency picker shows two lines, so it is `h-12`.
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
  - Every table row's actions are icon buttons in a last, hidden-label `Actions` column: work task (list), open (chevron right), edit (pencil), delete (trash, danger), run (play), new link (refresh, for an invitation that has no page of its own). The row's name is plain text, never a link. Each action's label names the row.
  - Hover feedback belongs only on things that react to a click. Rows, cards and panels that do nothing stay still.
  - Page and form actions are text buttons with a leading icon (`Save`, `Add Fee`, `Run Report`). Icon-only buttons are reserved for table row actions and chrome that every app shares: close, dismiss, back, menu, theme, sign out and reorder arrows. Each one carries a tooltip.
  - Every element earns its place. Pages and sections have a title; add a sentence, hint or label only when it tells the user something the title, the data or the control does not already say. Never add text to fill a slot, and never show the same data twice on a page.
  - Labels are Title Case; sentences stay sentence case.
  - A code always shows with its meaning as `Description (code)`, such as `Ambulance - Land (41)`; a bare code is shown only when no description is known.
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
- **No Routine Screenshots:** Verify changes with tests and `pnpm e2e`, not by launching the app to screenshot it. Take screenshots only to chase a bug or when a visual question is the point of the work.
