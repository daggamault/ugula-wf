# Overrides

Every built-in graph and shared table can be customized without code for one agency. Organizations own agencies but no graphs or tables: customization is built-in, then agency.

## Two ways to customize

| Kind               | What you change                                                          | Drift                                    |
| ------------------ | ------------------------------------------------------------------------ | ---------------------------------------- |
| **Table override** | The rows of a shared decision or lookup table, as a form (`/tables/:id`) | None: the graphs that use it stay as-is  |
| **Graph override** | A copy of one rule, stage or workflow                                    | Tracked: compare, Keep Mine, Start Fresh |

Tables hold only reference data: code sets, code labels, limits and settings, and pure code mappings. Every billing decision is a rule drawn on the canvas (conditions, first-that-applies choices, logic gates, rules run per item), so an agency changes a number or a code set by overriding its table, and changes how something is decided by overriding the rule (a graph override, `workflows:update`). Ugula ships one complete base set; an agency overrides only the graphs it needs, and drift on a copy is handled by Compare, Keep Mine and Start From Base.

## Two levels

| Level  | Owner                                                       | Applies to                  |
| ------ | ----------------------------------------------------------- | --------------------------- |
| System | Ugula (seeded)                                              | Everyone, unless overridden |
| Agency | Users with `workflows:update` or `workflows:manage` (below) | That agency only            |

A run uses the **agency** copy if one is active and published, else the **system** graph or table. A system row has `agency_id` null. Organization owners reach every agency in their organization, so they customize each agency like any member with the permissions.

## Roles and permission tiers

Every graph has a `role` (`graphs.role`), set by the seeds and copied by overrides:

| Role       | Meaning                                                                      | Agency copies need |
| ---------- | ---------------------------------------------------------------------------- | ------------------ |
| `workflow` | Runs on its own and reacts to an event (always the role of `kind: workflow`) | `workflows:manage` |
| `stage`    | A subworkflow with exec pins that sequences rules and actions                | `workflows:manage` |
| `rule`     | A pure subworkflow: facts in, decision out                                   | `workflows:update` |

Tables need `workflows:update`. `canEditScope` (`apps/api/src/shared/scopes.ts`) applies the tiers. New graphs created in the editor belong to the agency and are rules unless they are workflows. Only these custom graphs edit **Inputs and Outputs** in the editor, to define their pins, exits and variables; other graphs show it read-only, and a copy keeps the contract of the graph it overrides.

## Shared tables

Decision and lookup table nodes either carry their rules inline or reference a shared table: `config: { inputs, outputs, table: { key } }` (decision) or `{ type, table: { key } }` (lookup). The node keeps the fields, so its pins never depend on the table; the table holds the rules. A decision table can also name the reason for when no rule holds (`otherwiseLabel`), and its **Why** output (`reasons`) gives the matching rule's label or that reason.

- Tables live in `data_tables` / `data_table_versions` with the same scopes, `base_version_id`, one draft and immutable published versions as graphs. Their **contract** is their fields: input and output names and types (decision) or the value type (lookup) (`tableContract`).
- When a run starts, `pinRunGraphs` also pins every table its graphs reference into `workflow_run_tables`, agency first, then system; an agency copy applies only while its contract matches the newest system version. Child runs reuse their parent's pins.
- The worker inlines the pinned tables into the graphs before running them (`inlineTables`). A table that is missing or no longer has the node's fields faults the node with a clear message.
- The seeds declare shared tables with `createTables().decision(...)` and `.lookup(...)` in `.seeds/billing/`, all reference data (keys `billing.<kebab-case name>` unless noted; where they are used is in [Billing Workflows](billing-workflows.md)):
  - **Code sets:** Medicare Claim Filings, Medicaid Claim Filings, IV Solutions, ALS2 Procedures, Signature Exceptions, Not Signature Exceptions (`billing.signature-non-exceptions`), Claim Data Denials, Duplicate Claim Denials, Medical Necessity Denials, Other Payer Denials, Patient Denials, Late Filing Denials, Cost Share Codes, Sequestration Codes.
  - **Code labels:** Sex Labels, Response Mode Labels, Level of Care Labels, Reported Stay Kinds.
  - **Limits and settings:** Claim Policy, Check Limits, Check Severity, Federal Filing Limits, Deadline Limits, Unit Rounding, Underpayment Limits, MSP Employer Sizes, Document Chase Days, Appeal Levels, Refund Deadlines, Records Deadlines.
  - **Code mappings:** Base Rate (the CMS base rate code by level of service and emergency), Destination Modifier (destination type → letter), Line Code Modifier (`billing.code-modifier`), Transport Reason by Destination Reason (`billing.transport-reason-by-destination`), Payer by Payment Method (`billing.payment-method-payer`), Coverage Priority, Benefits Assignment, Adjustment Reasons, Adjustment Classes, Classes That Lower the Balance (`billing.balance-lowering-classes`), Task Deadline Kinds.
- The seed checks every reference resolves to a table with the same fields.
- A Where node can keep the items whose field is listed (or not listed) as a key of a shared table (`op: listed` or `notListed` with `table: { key }`), which is how a rule tests a code set; a Lookup Table also looks up a list of keys at once (`keys` → `values`).
- The API runs an agency's effective rule outside any run (`findRuleBundle`, `findGraphTables`, `runRule`) for the claim page's issues (Claim Issues: Claim Check Facts, then every check rule) and next step, so table and rule overrides show there as they apply in runs.

## Contracts

Every graph has a **key**, its permanent identity: subworkflow nodes call it by key, runs pin versions by key, and an override shares the key of the built-in it replaces. Built-in keys are readable names kept in the seeds (`billing.classification`). A graph an agency creates gets an opaque key (`custom.<10 characters>`) generated by the API and never shown when creating it, so renaming it can never leave a misleading key. Its name and description are edited from **Details** in the editor (`PUT /graphs/:id`) and never change the key; built-ins and overrides keep the name and description they were copied with.

An override must keep the signature of the system graph it replaces: the same exec ins, exits, inputs and outputs with the same names, types, optionality and whether each has a default (its value may change). This is the **contract** (`contractOf`), stored on every version.

- Publishing an override whose contract differs from the newest version of the system graph with its key fails. The same holds for table overrides and their fields.
- At run time an override applies only to the version of the system graph whose contract it matches. When Ugula ships a new system version with a different contract, older overrides stop applying (runs fall back to the system graph) until they are rebased, and the graph is marked **stale**.

## Lifecycle

| Action     | Endpoint                             | Notes                                                                                                                                                                     |
| ---------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Override   | `POST /graphs/:id/override`          | Copies the newest published version of the built-in graph you are looking at into a draft for the agency. Records `base_version_id`. Re-enables a removed copy as it was. |
| Edit draft | `PUT /graphs/:id/draft`              | Validates against the catalog, the graphs and the tables visible to the agency                                                                                            |
| Publish    | `POST /graphs/:id/publish`           | Checks issues and the contract; new runs use it immediately                                                                                                               |
| Compare    | `GET /graphs/:id/compare`            | Returns your newest version, the base version it was copied from and the base's newest version, and whether the base changed                                              |
| Rebase     | `POST /graphs/:id/rebase { mode }`   | `keep` keeps your definition and marks it as based on the newest base; `reset` replaces your draft with the newest base                                                   |
| Remove     | `DELETE /graphs/:id`                 | Turns an override off (runs go back to the built-in); a custom graph that overrides nothing is deleted, unless published graphs still call it                             |
| Map        | `GET /graphs/map`                    | Every effective graph with the graphs and tables it uses, and the effective table per key                                                                                 |
| Tables     | `GET, PUT, POST, DELETE /tables/...` | List (`show=customized`), `effective`, open, versions, compare, override, save draft, publish and remove table copies                                                     |

`GET /graphs/nodes` marks each key `overridden` when an agency copy is in effect, so parent graphs can highlight it. Runs that already started keep the versions they pinned; publishing or removing an override never changes them.

## Showing changes

`--color-custom` (fuchsia) means "this agency changed this":

- **Canvas:** on a copy, nodes added or changed against the version it was copied from (type, version, settings, inputs, label or note) get a custom outline and a **Custom** chip; new wires are drawn in the custom color; **Show Removed** adds the base's removed nodes as dashed ghosts. In any graph, a subworkflow or table node whose key your agency overrides gets the outline too.
- **Inspector:** a **Changed From Base** section lists each changed property with a custom dot, `Base: value` and **Reset to Base**; changed input pins carry the dot. Table nodes link to their table and say when it is customized.
- **Base Updated:** a copy whose base has a newer version, or which is stale, shows a warning and a **Compare** panel: Base Then, Base Now (what the base changed) and Yours (what you changed), in plain words, with **Keep Mine** and **Start From Base** (danger confirm).
- **Lists:** Workflows and Tables show the scope (Built-in, Agency), **Has Agency Copy** and **Base Updated** badges, and filter **Customized**. The **Customization Map** (`/workflows/customized`) shows each workflow's call tree with customized branches and tables highlighted, linking to each copy.

## Scope resolution in SQL

`libs/data/db/src/graph-versions.ts` resolves `key@version` for an agency, and `libs/data/db/src/data-tables.ts` resolves table keys the same way:

1. Active graphs (or tables) with that key that are system (`agency_id` null) or the agency's.
2. A reference `key@version` names a version of the system graph with that key, else of the agency's custom graph. That graph matches on the exact version; an agency copy of a system graph uses its newest published version whose contract equals that version's contract (the newest system version for tables), never its own version numbers.
3. Agency first, then system.

## Not built yet

- Apply Base Changes per node (a three-way merge); today Keep Mine or Start From Base.
- Marking the run steps that executed agency logic on a run's page.
- Table rebase; publishing a table copy checks its fields against the newest built-in instead.
