# Workflow Engine

`libs/kernel/graph` is a general engine; it knows nothing about billing.

## Graphs

A graph (`GraphDef`) has a **signature**, **variables**, **nodes**, **edges** and optional **comments**.

- **Exec wires** carry control flow between exec pins (`execIn`, `execOut`).
- **Data wires** carry typed values between input and output pins.
- A graph's signature is what callers see: exec ins and outs (exits), typed inputs and outputs. Pins and variables can have a `label`, and pins a `description`; exits can be documented in `signature.exits` (`label`, `description`). Nodes can carry a `note`, shown on the canvas, and `shown`, the fields a Break or Make node reveals on the canvas, which only the editor reads.
- `documentationIssues(def)` lists pins without a description, exits without a label or description and labels that are not Title Case; the editor shows them as warnings, never blocking.
- Graph kinds: `workflow` (runs on its own) and `node` (a subworkflow other graphs call as a node). Every graph also has a role (`workflow`, `stage`, `rule`) that sets who may override it; see [Overrides](overrides.md).
- `comments` are boxes drawn behind nodes (`id`, `text`, `position`, `size`, optional `color` from `COMMENT_COLORS`). They are layout only: the engine, validation and `contractOf` ignore them, and an override that only adds or moves comments changes nothing.
- `runRule({ nodes, graphs }, ref, inputs, now)` evaluates a pure graph (a rule) outside a run, through a one-step host graph, and returns its outputs.

## Types

Pin, variable and field types are `ValueType`s, written as text by `formatType` and read by `parseType`:

| Type     | Text                                                        | Value                            |
| -------- | ----------------------------------------------------------- | -------------------------------- |
| Scalar   | `any`, `string`, `number`, `integer`, `boolean`, `datetime` | A JSON value                     |
| Identity | `id<claim>`                                                 | Text naming one record of a kind |
| Code     | `code<hcpcs>`                                               | Text from one code set           |
| List     | `list<code<icd10>>`                                         | A JSON array                     |
| Object   | `object{id: id<claim>, total: integer}`                     | A JSON object                    |
| Record   | `model<claim>`                                              | A JSON object shaped by a model  |

`isAssignable(from, to)` decides which wires connect, as in Unreal Blueprints:

- `any` connects to and from everything.
- A record is an object tagged with the model it follows (`{ object: {...}, model: 'claim' }`, built by `modelType`). A pin typed by a model only takes that model, so a Coverage cannot go where a Claim is wanted, while a model still connects to any plain object whose fields it has (Merge, Get Field and the other object primitives keep working). `parseType` does not read `model<…>`, since the fields come from the model. `validateGraph` reports a model nobody registered once the registry knows models (`valueKinds.models`). IDs and records stay separate types: a workflow passes IDs and reads a record with **Read Claim**, **Read Patient**, **Read Payer** or **Read Encounter** only when it needs the fields.
- An identity or code connects to the same kind, or to plain `string` (it widens). Plain `string` never connects to a kind, so a Patient ID cannot go where a Claim ID is expected: give the source its kind (a typed pin, field, variable or table column) or convert it with To Code.
- `integer` and `number`, and `string` and `datetime`, connect both ways; lists connect when their items do.
- An object connects to an object type only when it has every field of the target, each assignable; `object{}` accepts any object. Object fields have no optionality: a missing value is `null`.

At run time a kind is plain text (`checkValue`); `isTextType` tells the types entered as text.

The engine knows no kinds of its own beyond `run` (`STD_KINDS`); kind names only have to be camelCase (`a-z` first). Each domain declares the kinds it owns with their labels (`billingKinds`: `claim`, `patient`, `payer`, `task` and `hcpcs`, `icd10`, `modifier`, `tripClassification`, `levelOfService`, `placeCode`, `x12Relationship`; `nemsisKinds`: `encounter`, `import`, `report` and one code kind per NEMSIS code set the Encounter reads, such as `incidentDisposition`, `serviceType`, `locationType`, `destinationType`, `medicationRoute`, `rxnorm` and `snomed`), and `valueKinds` in `libs/composition/catalog` merges them (`mergeKinds`). `createRegistry(nodes, graphs, kinds)` carries them, and `validateGraph` reports any graph pin, variable or node pin using a kind nobody declared (`unknownKinds`), so the API save and the seed gate catch typos. The editor names a kind by its label, or by its name in Title Case.

## Nodes

Nodes are defined with `pureNode`, `actionNode` or `branchNode` and `pin()` (`libs/kernel/graph/src/define.ts`). The engine checks inputs, outputs and exits, so node code only checks domain rules.

A node definition (`NodeDef`) also carries what the editor shows:

- `level`: `basic` for what billers compose rules from (service nodes, tables, human tasks, Select, Choose Value, comparisons, logic, math, text, time, list basics, rules run per item, fields, Make and Break, Constant, branch, switch, for each, sequence, run and start workflow, Reroute), `advanced` for internals (formulas, variables, untyped paths, JSON, loop and gate machinery).
- `keywords`: more words the palette search matches.
- `exits`: a label and description per exec output, as in `signature.exits`. `branchNode` takes them as `exits: { name: { label, description } }`, whose keys are its exec outputs.
- `summary(config)`: one line describing the configured node on the canvas (the formula, `Table: <key>`, `Task: <title>`, the switch cases, the variable or workflow), or `null`.
- `adopts`: which input pins set which config key when a typed wire is first connected (`adoptsType`, `adoptsItemType`, or a record for Get and Set Field). Generic primitives take a `type` config (`any` by default) that types their pins: list nodes, Equal, Not Equal and the comparisons, Select, Coalesce, Choose Value, Make and Join List, For Each and Reroute. The editor reads `adopts` from the catalog (`adoptionsOf`), so once Contains has a `list<code<serviceType>>` wired in, its item only takes a `code<serviceType>`.

`nodeDocumentationIssues(def)` checks a node as first placed: a Title Case title and a description, every input and output described, every exit other than `then` labelled or described, pin and exit labels in Title Case (`isTitleCase`). The catalog test runs it over every registered node, and checks that every model field has a Title Case label and a description.

**Run Rule for Each**, **Keep Items Where** and **Find Item Where** (`std.list.map-rule`, `filter-rule`, `find-rule`) run a rule (a pure `node` graph, set as `{ rule, version, item }`, plus `test` for the last two) once per list item. `item` names the rule input each item goes to; the rule's other inputs become the node's own and are the same for every item. Their pins take their types from the rule (`SignatureContext.signatureOf`), the engine runs the rule through `NodeContext.evaluate`, and `graphRefs` counts the rule as a subgraph, so it is validated, pinned and retargeted like one. This is how per-item logic stays on the canvas instead of in a formula.

Pure primitives tolerate missing data: math nodes give nothing when a number is missing, and list nodes treat a missing list as empty, so a rule that reads an optional field only fails where a value is truly required.

Primitives that keep decisions readable on the canvas:

- Tests are small typed primitives: a **Constant** list of codes and **Contains**, **Equal** and **Not Equal**, **Greater Than** and the other comparisons, **Is Null** and **Starts with**; **And** and **Or** combine any number of them (set how many conditions they take) and **Not** turns one around, **Select** gives a value when a test holds, and **Choose Value** picks by case or the first that is set. A rule that returns a decision with reasons gives each reason with a Select and collects them with Make List, which leaves out the empty ones.
- **Round** rounds to the nearest, up or down (`direction`); **Start of Period** and **Time Between** do the date math.
- Text: **Join** takes a **Last Separator** ("a, b and c"), **Count with Noun** writes "1 warning" or "3 warnings", **Capitalize** capitalizes the first letter, **Text Template** fills a fixed pattern with optional parts, and **Fill Template** fills a pattern that arrives on a wire, such as a message from a table. For free text such as a narrative, **Find Phrases** tells which phrases are mentioned as whole words, skipping a mention a negation (no, denies, without) shortly precedes in its sentence, and **Find Pattern** gives the first match of a regular expression and its parts, such as the miles in "12.4 loaded miles". Text tests (Contains, Starts with, Ends with) are false on empty text.

Node titles are Title Case with minor words in lowercase (Greater or Equal, Wait for Signal, Sort by Field, Start of Period).

`std.flow.reroute` is a knot on a wire: it passes `value` through unchanged, typed by its `type` setting (`any` by default).

| Kind      | Examples                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standard  | flow (branch, switch, reroute, for-each, while, try, wait, wait for signal, run/start/map/spawn workflows), variables, math, logic, text, lists, objects, time, tables (Decision Table, Lookup Table, inline or a shared table by key), human task, HTTP                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Records   | A **Break** and a **Make** node per record (`createModelNodes`): the Encounter and its parts in `libs/domain/nemsis` (Person, Address, Scene, Destination, Times, Odometer, Payment, Insurance, Medication, Procedure, Vital Signs, Signature, Crew Member, Attachment), the Claim, Coverage, Charge Line, Patient, Patient Address and Payer in `libs/domain/billing`                                                                                                                                                                                                                                                                                                        |
| Services  | Nodes that do I/O: Read PCR File (`pcr-file.read`), Read PCR (`report.read`), Save Encounter and Read Encounter (`libs/domain/nemsis/src/nodes.ts`); Find Patient, Save Patient, Read Patient, Find Payer, Read Payer, Find Fee, Save Claim, Read Claim, Check Claim, Record Claim Review, Check Diagnoses and Search Diagnoses (`libs/domain/billing/src/nodes.ts`). They reach the database through store ports the worker implements. IDs and records stay separate: a node that finds or saves a record gives its ID, and a Read node turns an ID into the record when a graph needs its fields; each Read node branches **Found**, with the record, or **Not Found**, with no outputs |
| Composite | Any published `node` graph, called like a node                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Triggers and events

Like an Unreal **Event** node or an n8n trigger, a workflow's start node (`Entry`) says what starts it (`config.trigger`, `triggerSchema` in `libs/kernel/graph/src/triggers.ts`):

| Trigger  | Config                              | Starts                                                                                                                                            |
| -------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual   | `{ kind: 'manual' }` (the default)  | From the app, the API or another graph (run, start, map and spawn workflow nodes)                                                                 |
| On Event | `{ kind: 'event', event, where }`   | Once per event of that type whose payload passes every `where` test (is, one of, more than and the other condition tests, as in a Decision Table) |
| Schedule | `{ kind: 'schedule', every, hour }` | Every day, every Monday or the first of every month, at the hour in the agency's time zone                                                        |

- **Events** are typed: each domain declares an `EventDef` (`type` such as `encounter.created`, `label`, `description` and `payload` pins), and `workflowEvents` in `libs/composition/catalog` merges them. `createRegistry(nodes, graphs, kinds, events)` carries them, and `validateGraph` (`triggerIssues`) checks that the event exists, that each tested field is in its payload, and that every input of the workflow is a payload field of an assignable type, optional or defaulted; a scheduled workflow gets no inputs, so each needs a default. Only a `workflow` graph may have a trigger (`SUBWORKFLOW_TRIGGER`, checked on save, publish and seed). A run takes the payload fields its inputs name (`triggerInputs`).
- **Outbox:** an event is a row in `events`, written in the same transaction as the change it reports. Code writes one with `emitEvent` (`libs/data/db/src/events.ts`); encounters, claims and tasks write theirs with database triggers (`.migrations/events.ts`), so no code path can save an encounter or claim without its event. Every insert notifies `workflow_events`.
- **Dispatcher:** each worker listens on `workflow_events` (and sweeps every 30 seconds in case it missed a notice) and runs `dispatchEvents`: it takes up to 100 undispatched events `for update skip locked`, finds the agency's effective published workflows whose trigger names the event (`findEventWorkflows`: overrides resolved like any run, so an agency copy that changes or drops the trigger replaces the built-in one), starts one run per match with `startRun` (pinned, leased and fenced like every run), records it in `event_runs` (event, workflow, run; one run per event and workflow) and marks the batch dispatched, all in one transaction. A person's action that should open its run at once (a PCR file upload) uses `emitAndDispatch`, which starts the runs in the request's own transaction and returns them; the run is interactive and started by that user.
- **Schedules:** `graph_versions.trigger` is a stored column generated from the definition, indexed by kind and event. The worker's `workflow-schedules` job (every 15 minutes) asks, per active agency, for its scheduled workflows (`findScheduledWorkflows`), and starts each once its period has reached the hour in the agency's time zone, claiming `schedule_runs` (agency, workflow, day) first so a retried job never starts it twice.
- **Where it shows:** the editor's **Trigger** section on a workflow's start node picks the start, the event and its conditions or the schedule; the canvas titles the node by it (Start, On Encounter Created, On Schedule) and summarises it ("On Encounter Created (1 condition)", "Every Day at 06:00"); the Workflows list has a **Starts** column; a run started by an event says which one.

The events today:

| Event               | Payload                                | Written by                                                   |
| ------------------- | -------------------------------------- | ------------------------------------------------------------ |
| `pcr_file.received` | `importId`, `file`, `fileName`         | The API, when a NEMSIS file is uploaded or arrives over SFTP |
| `encounter.created` | `encounterId`, `pcrNumber`             | A trigger, when an encounter is inserted                     |
| `encounter.revised` | `encounterId`, `pcrNumber`, `revision` | A trigger, when an encounter's revision rises                |
| `claim.created`     | `claimId`, `encounterId`               | A trigger, when a claim is inserted                          |
| `task.completed`    | `taskId`, `queue`, `outcome`           | A trigger, when a task is completed                          |

An agency adds "when a claim is created, do X" by creating a workflow on `claim.created`; it runs next to the built-in workflows without overriding them.

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

| Concern                          | File                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Types                            | `libs/kernel/graph/src/types.ts`                                                                                              |
| Schema validation of definitions | `libs/kernel/graph/src/schemas.ts`                                                                                            |
| Compile, refs, contracts         | `libs/kernel/graph/src/compile.ts`                                                                                            |
| Engine                           | `libs/kernel/graph/src/engine.ts`                                                                                             |
| Standard nodes                   | `libs/kernel/graph/src/std/*.ts`                                                                                              |
| Resolution and pinning SQL       | `libs/data/db/src/graph-versions.ts`, `data-tables.ts`                                                                        |
| Triggers, events, dispatch       | `libs/kernel/graph/src/triggers.ts`, `libs/data/db/src/events.ts`, `apps/worker/src/features/events`, `.migrations/events.ts` |
| Shared tables, docs lint         | `libs/kernel/graph/src/std/tables.ts`, `documentation.ts`                                                                     |
| Worker execution                 | `apps/worker/src/features/workflows/*`                                                                                        |
