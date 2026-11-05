# Overrides

Every built-in graph and shared table can be customized without code, for a whole organization or for one agency.

## Three ways to customize

| Kind               | What you change                                                          | Drift                                    |
| ------------------ | ------------------------------------------------------------------------ | ---------------------------------------- |
| **Table override** | The rows of a shared decision or lookup table, as a form (`/tables/:id`) | None: the graphs that use it stay as-is  |
| **Agency rule**    | An empty **slot** subworkflow that runs after the base rules             | None: the base keeps updating around it  |
| **Graph override** | A copy of one rule, stage or workflow                                    | Tracked: compare, Keep Mine, Start Fresh |

## Three levels

| Level        | Owner                                                       | Applies to                       |
| ------------ | ----------------------------------------------------------- | -------------------------------- |
| System       | Ugula (seeded)                                              | Everyone, unless overridden      |
| Organization | Organization owners                                         | Every agency in the organization |
| Agency       | Users with `workflows:update` or `workflows:manage` (below) | That agency only                 |

A run uses the **agency** copy if one is active and published, else the **organization** copy, else the **system** graph or table.

## Roles and permission tiers

Every graph has a `role` (`graphs.role`), set by the seeds and copied by overrides:

| Role       | Meaning                                                                      | Agency copies need |
| ---------- | ---------------------------------------------------------------------------- | ------------------ |
| `workflow` | Runs on its own and reacts to an event (always the role of `kind: workflow`) | `workflows:manage` |
| `stage`    | A subworkflow with exec pins that sequences rules and actions                | `workflows:manage` |
| `rule`     | A pure subworkflow: facts in, decision out                                   | `workflows:update` |
| `slot`     | An empty Agency Rule: a pure pass-through meant to be overridden             | `workflows:update` |

Tables need `workflows:update`. Organization copies always need an organization owner. `canEditScope` (`apps/api/src/shared/scopes.ts`) applies the tiers. New graphs created in the editor are rules unless they are workflows.

## Agency rule slots

A slot is a subworkflow whose system version hands its inputs straight back (`slotGraph` in `libs/kernel/graph/src/slot.ts`; `isPassThrough` tells the editor it is still empty). Every output has an input of the same name and type, plus optional context inputs. The seeds build them with `slot(key, name, description, signature)` from `.seeds/builder.ts`. Nothing is special at run time: an agency overrides the slot like any rule, and only that agency's runs see the change.

| Slot                       | Runs after                                        | Passes through       | Context               |
| -------------------------- | ------------------------------------------------- | -------------------- | --------------------- |
| `billing.agency-facts`     | Map Encounter Facts                               | `facts`              | `pcr`                 |
| `billing.agency-trip-type` | Trip Type (in Classify Trip)                      | `tripType`, `reason` | `facts`               |
| `billing.agency-service`   | the trip type's service (in Determine Service)    | `service`            | `tripType`, `facts`   |
| `billing.agency-diagnoses` | Diagnoses From Coded Impressions                  | `diagnoses`          | `facts`               |
| `billing.agency-payers`    | Coordination Order (in Determine Payers)          | `coverages`          | `pcr`                 |
| `billing.agency-charges`   | Map Charges (in Assign Charges)                   | `lines`              | `tripType`, `service` |
| `billing.agency-claim`     | Assign Claim Properties (in Build Claim)          | `claim`              | `pcr`                 |
| `billing.agency-checks`    | the base checks, before severities (Claim Checks) | `issues`             | `facts`               |
| `billing.agency-837p`      | Map 837P Claim                                    | `x837`               | `claim`               |

## Shared tables

Decision and lookup table nodes either carry their rules inline or reference a shared table: `config: { inputs, outputs, table: { key } }` (decision) or `{ type, table: { key } }` (lookup). The node keeps the fields, so its pins never depend on the table; the table holds the rules.

- Tables live in `data_tables` / `data_table_versions` with the same scopes, `base_version_id`, one draft and immutable published versions as graphs. Their **contract** is their fields: input and output names and types (decision) or the value type (lookup) (`tableContract`).
- When a run starts, `pinRunGraphs` also pins every table its graphs reference into `workflow_run_tables`, agency first, then organization, then system; organization and agency copies apply only while their contract matches the newest system version. Child runs reuse their parent's pins.
- The worker inlines the pinned tables into the graphs before running them (`inlineTables`). A table that is missing or no longer has the node's fields faults the node with a clear message.
- The seeds declare shared tables with `createTables().decision(...)` and `.lookup(...)` in `.seeds/billing/`: Trip Type, Level of Service, Emergency Response, Base Rate, Mileage, Origin Modifier, Destination Modifier, Transport Reason by Destination Reason, Payer by Payment Method, Coverage Priority, Ambulance Conditions, Coverage Modifier, Reprice Triggers, Check Severity, Claim Policy, Claim Steps, Adjustment Classes, Remittance Routing, Denial Categories, Correction Methods, Appeal Levels, Appeal Decisions, Records Deadlines, Refund Deadlines, Balance-Billing Protection, Deadline Actions, MSP From the Report, Medicare Secondary Payer, Pronounced Dead, Non-Covered Miles, Non-Covered Mileage, Trip Modifiers, Line Code Modifier, Narrative Note, Facility Responsibility, Document Kinds and Document Chase Days (keys in [Billing Workflows](billing-workflows.md)). The seed checks every reference resolves to a table with the same fields.
- A Lookup Table also looks up a list of keys at once (`keys` → `values`), which is how one Check Severity table rates every issue and Adjustment Classes classes every adjustment.
- The API runs an agency's effective rule outside any run (`findRuleBundle`, `findGraphTables`, `runRule`) for the claim page's issues and next step, so table and rule overrides show there as they apply in runs.

## Contracts

An override must keep the signature of the system graph it replaces: the same exec ins, exits, inputs and outputs with the same names, types and optionality. This is the **contract** (`contractOf`), stored on every version.

- Publishing an override whose contract differs from the newest system version fails; the same holds for table overrides and their fields.
- At run time an override applies only to the system version whose contract it matches. When Ugula ships a new system version with a different contract, older overrides stop applying (runs fall back to the system graph) until they are rebased, and the graph is marked **stale**.

## Lifecycle

| Action     | Endpoint                              | Notes                                                                                                                                                                            |
| ---------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Override   | `POST /graphs/:id/override { scope }` | Copies the newest published version of the graph you are looking at into a draft for the organization or agency. Records `base_version_id`. Re-enables a removed copy as it was. |
| Edit draft | `PUT /graphs/:id/draft`               | Validates against the catalog, the graphs and the tables visible to the agency                                                                                                   |
| Publish    | `POST /graphs/:id/publish`            | Checks issues and the contract; new runs use it immediately                                                                                                                      |
| Compare    | `GET /graphs/:id/compare`             | Returns your newest version, the base version it was copied from and the base's newest version, and whether the base changed                                                     |
| Rebase     | `POST /graphs/:id/rebase { mode }`    | `keep` keeps your definition and marks it as based on the newest base; `reset` replaces your draft with the newest base                                                          |
| Remove     | `DELETE /graphs/:id`                  | Turns an override off (runs go back to the level below); a custom graph that overrides nothing is deleted                                                                        |
| Map        | `GET /graphs/map`                     | Every effective graph with the graphs and tables it uses, and the effective table per key                                                                                        |
| Tables     | `GET, PUT, POST, DELETE /tables/...`  | List (`show=customized`), `effective`, open, versions, compare, override, save draft, publish and remove table copies                                                            |

`GET /graphs/nodes` marks each key `overridden` when an organization or agency copy is in effect, so parent graphs can highlight it. Runs that already started keep the versions they pinned; publishing or removing an override never changes them.

## Showing changes

`--color-custom` (fuchsia) means "this organization or agency changed this":

- **Canvas:** on a copy, nodes added or changed against the version it was copied from (type, version, settings, inputs, label or note) get a custom outline and a **Custom** chip; new wires are drawn in the custom color; **Show Removed** adds the base's removed nodes as dashed ghosts. In any graph, a subworkflow or table node whose key your organization or agency overrides gets the outline too.
- **Inspector:** a **Changed From Base** section lists each changed property with a custom dot, `Base: value` and **Reset to Base**; changed input pins carry the dot. Table nodes link to their table and say when it is customized.
- **Base Updated:** a copy whose base has a newer version, or which is stale, shows a warning and a **Compare** panel: Base Then, Base Now (what the base changed) and Yours (what you changed), in plain words, with **Keep Mine** and **Start From Base** (danger confirm).
- **Lists:** Workflows and Tables show the scope (Built-in, Organization, Agency), **Has Your Copy**, **Base Updated** and **Agency Rule** badges, and filter **Customized**. The **Customization Map** (`/workflows/customized`) shows each workflow's call tree with customized branches and tables highlighted, linking to each copy.

## Scope resolution in SQL

`libs/data/db/src/graph-versions.ts` resolves `key@version` for an agency, and `libs/data/db/src/data-tables.ts` resolves table keys the same way:

1. Active graphs (or tables) with that key that are system, the agency's organization (agency null), or the agency.
2. For organization and agency copies, the newest published version whose contract equals the requested system version's contract (the newest system version for tables), or the exact version for custom graphs with no system graph.
3. Agency first, then organization, then system.

## Not built yet

- Apply Base Changes per node (a three-way merge); today Keep Mine or Start From Base.
- Marking the run steps that executed agency logic on a run's page.
- Table rebase; publishing a table copy checks its fields against the newest built-in instead.
