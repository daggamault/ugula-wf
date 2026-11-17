# Workflow Engine

`libs/kernel/graph` is a general engine; it knows nothing about billing.

## Graphs

A graph (`GraphDef`) has a **signature**, **variables**, **nodes**, **edges** and optional **comments**.

- **Exec wires** carry control flow between exec pins (`execIn`, `execOut`).
- **Data wires** carry typed values between input and output pins.
- A graph's signature is what callers see: exec ins and outs (exits), typed inputs and outputs. Pins can have a `label` and a `description`; exits can be documented in `signature.exits` (`label`, `description`). Nodes can carry a `note`, shown on the canvas, and `shown`, the fields a Break or Make node reveals on the canvas, which only the editor reads.
- `documentationIssues(def)` lists pins without a description, exits without a label or description and labels that are not Title Case; the editor shows them as warnings, never blocking.
- Graph kinds: `workflow` (runs on its own) and `node` (a subworkflow other graphs call as a node). Every graph also has a role (`workflow`, `stage`, `rule`, `slot`) that sets who may override it; see [Overrides](overrides.md).
- `comments` are boxes drawn behind nodes (`id`, `text`, `position`, `size`, optional `color` from `COMMENT_COLORS`). They are layout only: the engine, validation and `contractOf` ignore them, and an override that only adds or moves comments changes nothing.
- `slotGraph(signature)` builds an empty Agency Rule: a pass-through whose outputs are its same-named inputs; `isPassThrough(def)` says whether a slot is still empty.
- `runRule({ nodes, graphs }, ref, inputs, now)` evaluates a pure graph (a rule) outside a run, through a one-step host graph, and returns its outputs; the API uses it to show the agency's own rules on a claim.

## Types

Pin, variable and field types are `ValueType`s, written as text by `formatType` and read by `parseType`:

| Type     | Text                                                        | Value                            |
| -------- | ----------------------------------------------------------- | -------------------------------- |
| Scalar   | `any`, `string`, `number`, `integer`, `boolean`, `datetime` | A JSON value                     |
| Identity | `id<claim>`                                                 | Text naming one record of a kind |
| Code     | `code<hcpcs>`                                               | Text from one code set           |
| List     | `list<code<icd10>>`                                         | A JSON array                     |
| Object   | `object{id: id<claim>, total: integer}`                     | A JSON object                    |

`isAssignable(from, to)` decides which wires connect, as in Unreal Blueprints:

- `any` connects to and from everything.
- An identity or code connects to the same kind, or to plain `string` (it widens). Plain `string` never connects to a kind, so a Patient ID cannot go where a Claim ID is expected: give the source its kind (a typed pin, field, variable or table column) or convert it with To Code.
- `integer` and `number`, and `string` and `datetime`, connect both ways; lists connect when their items do.
- An object connects to an object type only when it has every field of the target, each assignable; `object{}` accepts any object. Object fields have no optionality: a missing value is `null`.

At run time a kind is plain text (`checkValue`); `isTextType` tells the types entered as text.

The engine knows no kinds of its own beyond `run` (`STD_KINDS`); kind names only have to be camelCase (`a-z` first). Each domain declares the kinds it owns with their labels (`billingKinds`: `claim`, `coverage`, `document`, `facility`, `patient`, `payer`, `payerFile`, `task` and `carc`, `hcpcs`, `icd10`, `modifier`, `rarc`; `nemsisKinds`: `icd10`), and `valueKinds` in `libs/composition/catalog` merges them (`mergeKinds`). `createRegistry(nodes, graphs, kinds)` carries them, and `validateGraph` reports any graph pin, variable or node pin using a kind nobody declared (`unknownKinds`), so the API save and the seed gate catch typos. The editor names a kind by its label, or by its name in Title Case.

## Nodes

Nodes are defined with `pureNode`, `actionNode` or `branchNode` and `pin()` (`libs/kernel/graph/src/define.ts`). The engine checks inputs, outputs and exits, so node code only checks domain rules.

A node definition (`NodeDef`) also carries what the editor shows:

- `level`: `basic` for what billers compose rules from (billing and NEMSIS actions, tables, human tasks, conditions, Choose Value, comparisons, logic, math, text, time, list basics, rules run per item, fields, Make and Break, Constant, branch, switch, for each, sequence, run and start workflow, Reroute), `advanced` for internals (formulas, variables, untyped paths, JSON, loop and gate machinery).
- `keywords`: more words the palette search matches.
- `exits`: a label and description per exec output, as in `signature.exits`. `branchNode` takes them as `exits: { name: { label, description } }`, whose keys are its exec outputs.
- `summary(config)`: one line describing the configured node on the canvas (the formula, `Table: <key>`, `Task: <title>`, the switch cases, the variable or workflow), or `null`.

`nodeDocumentationIssues(def)` checks a node as first placed: every input and output described, every exit other than `then` labelled or described, labels in Title Case. The catalog test runs it over every registered node.

**Run Rule for Each**, **Keep Items Where** and **Find Item Where** (`std.list.map-rule`, `filter-rule`, `find-rule`) run a rule (a pure `node` graph, set as `{ rule, version, item }`, plus `test` for the last two) once per list item. `item` names the rule input each item goes to; the rule's other inputs become the node's own and are the same for every item. Their pins take their types from the rule (`SignatureContext.signatureOf`), the engine runs the rule through `NodeContext.evaluate`, and `graphRefs` counts the rule as a subgraph, so it is validated, pinned and retargeted like one. This is how per-item logic stays on the canvas instead of in a formula.

Pure primitives tolerate missing data: math nodes give nothing when a number is missing, and list nodes treat a missing list as empty, so a rule that reads an optional field only fails where a value is truly required.

Primitives that keep decisions readable on the canvas:

- **Condition** tests its inputs and reads as a sentence ("Loaded Miles is more than 500"); a test can compare an input with a value or with another input (`input`), so a limit wired from a table needs no arithmetic first. **Choose Value** picks by case or the first that is set, and And, Or and Not combine tests.
- **Where** keeps the items whose field passes a test, including `listed` and `notListed` against the keys of a shared table (`table: { key }`), so a code set stays a table.
- **Round** rounds to the nearest, up or down (`direction`); **Start of Period** and **Time Between** do the date math.
- Text: **Join** takes a **Last Separator** ("a, b and c"), **Count with Noun** writes "1 warning" or "3 warnings", **Capitalize** capitalizes the first letter, **Text Template** fills a fixed pattern with optional parts, and **Fill Template** fills a pattern that arrives on a wire, such as a message from a table.

Node titles are Title Case with minor words in lowercase (Greater or Equal, Wait for Signal, Sort by Field, Start of Period).

`std.flow.reroute` is a knot on a wire: it passes `value` through unchanged, typed by its `type` setting (`any` by default).

| Kind       | Examples                                                                                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standard   | flow (branch, switch, reroute, for-each, while, try, wait, wait for signal, run/start/map/spawn workflows), variables, math, logic, text, lists, objects, time, tables (Decision Table, Lookup Table, inline or a shared table by key; Where can keep items listed in a shared table), human task, HTTP |
| Models     | A **Break** and a **Make** node per model field set (NEMSIS sections, claim, 837P parts)                                                                                                                                                                                                                |
| Capability | Billing and NEMSIS nodes that do I/O or heavy logic: read NEMSIS, match patients and payers, read narratives, price, save claims, file 837P, apply payer files                                                                                                                                          |
| Composite  | Any published `node` graph, called like a node                                                                                                                                                                                                                                                          |

## Durable runs

- Run state is saved in Postgres after every node with side effects and every few pure steps.
- A run can suspend on a human task, timer, signal or child runs and resume on any worker. A human task can carry a due date (its `due` input) and the permission whoever completes it needs (`permission` in its config).
- Signals are counted, so a run that was busy when a signal arrived still sees it.
- Workers lease runs with fencing tokens; a sweeper recovers stalled leases; transient errors retry; real faults stop the run for inspection and retry.
- The queue runs what a person is waiting on first: runs started from the app (`startRun` with `interactive`) and commands such as resuming a completed task, then timed wakes, then background steps.

## Child runs

`std.flow.run-workflow`, `start-workflow`, `map-workflow` and `spawn-workflows` start child runs. Their target `{ workflow, version }` is recorded as a dependency of the graph version (`workflowRefs`), so it is pinned with the parent.

## Version pinning

- Every published graph version is immutable (a trigger rejects updates) and records its `dependencies` (`key@version`) and a `contract` fingerprint of its signature (`contractOf`).
- When a run starts, `pinRunGraphs` resolves the whole dependency bundle for the run's agency into `workflow_run_graphs`, then pins every shared table those graphs reference into `workflow_run_tables`. The worker builds its engine only from those rows, inlining each pinned table into its table nodes (`inlineTables`).
- A child run first reuses its parent's pinned version for any graph key or table key the parent pinned, then resolves the rest.
- Seeding never edits a published version: a changed definition becomes a new version, and references in other seeded graphs are moved to it (`retargetRefs`).

## Where things live

| Concern                          | File                                                                 |
| -------------------------------- | -------------------------------------------------------------------- |
| Types                            | `libs/kernel/graph/src/types.ts`                                     |
| Schema validation of definitions | `libs/kernel/graph/src/schemas.ts`                                   |
| Compile, refs, contracts         | `libs/kernel/graph/src/compile.ts`                                   |
| Engine                           | `libs/kernel/graph/src/engine.ts`                                    |
| Standard nodes                   | `libs/kernel/graph/src/std/*.ts`                                     |
| Resolution and pinning SQL       | `libs/data/db/src/graph-versions.ts`, `data-tables.ts`               |
| Shared tables, slots, docs lint  | `libs/kernel/graph/src/std/tables.ts`, `slot.ts`, `documentation.ts` |
| Worker execution                 | `apps/worker/src/features/workflows/*`                               |
