# Workflow Engine

`libs/kernel/graph` is a general engine; it knows nothing about billing.

## Graphs

A graph (`GraphDef`) has a **signature**, **variables**, **nodes** and **edges**.

- **Exec wires** carry control flow between exec pins (`execIn`, `execOut`).
- **Data wires** carry typed values between input and output pins.
- A graph's signature is what callers see: exec ins and outs (exits), typed inputs and outputs. Pins can have a `label` and a `description`; exits can be documented in `signature.exits`.
- Graph kinds: `workflow` (runs on its own) and `node` (a subworkflow other graphs call as a node).

## Nodes

Nodes are defined with `pureNode`, `actionNode` or `branchNode` and `pin()` (`libs/kernel/graph/src/define.ts`). The engine checks inputs, outputs and exits, so node code only checks domain rules.

| Kind       | Examples                                                                                                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standard   | flow (branch, switch, for-each, while, try, wait, wait for signal, run/start/map/spawn workflows), variables, math, logic, text, lists, objects, time, tables (Decision Table, Lookup Table), human task, HTTP |
| Models     | A **Break** and a **Make** node per model field set (NEMSIS sections, claim, 837P parts)                                                                                                                       |
| Capability | Billing and NEMSIS nodes that do I/O or heavy logic: read NEMSIS, match patients and payers, read narratives, price, save claims, file 837P, apply payer files                                                 |
| Composite  | Any published `node` graph, called like a node                                                                                                                                                                 |

## Durable runs

- Run state is saved in Postgres after every node with side effects and every few pure steps.
- A run can suspend on a human task, timer, signal or child runs and resume on any worker.
- Signals are counted, so a run that was busy when a signal arrived still sees it.
- Workers lease runs with fencing tokens; a sweeper recovers stalled leases; transient errors retry; real faults stop the run for inspection and retry.

## Child runs

`std.flow.run-workflow`, `start-workflow`, `map-workflow` and `spawn-workflows` start child runs. Their target `{ workflow, version }` is recorded as a dependency of the graph version (`workflowRefs`), so it is pinned with the parent.

## Version pinning

- Every published graph version is immutable (a trigger rejects updates) and records its `dependencies` (`key@version`) and a `contract` fingerprint of its signature (`contractOf`).
- When a run starts, `pinRunGraphs` resolves the whole dependency bundle for the run's agency into `workflow_run_graphs`. The worker builds its engine only from those rows.
- A child run first reuses its parent's pinned version for any key the parent pinned, then resolves the rest.
- Seeding never edits a published version: a changed definition becomes a new version, and references in other seeded graphs are moved to it (`retargetRefs`).

## Where things live

| Concern                          | File                                   |
| -------------------------------- | -------------------------------------- |
| Types                            | `libs/kernel/graph/src/types.ts`       |
| Schema validation of definitions | `libs/kernel/graph/src/schemas.ts`     |
| Compile, refs, contracts         | `libs/kernel/graph/src/compile.ts`     |
| Engine                           | `libs/kernel/graph/src/engine.ts`      |
| Standard nodes                   | `libs/kernel/graph/src/std/*.ts`       |
| Resolution and pinning SQL       | `libs/data/db/src/graph-versions.ts`   |
| Worker execution                 | `apps/worker/src/features/workflows/*` |
