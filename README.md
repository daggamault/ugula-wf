# Ugula

Ugula is a durable, visual workflow engine (think Unreal Blueprints meets n8n) with an EMS ambulance billing app built on top of it. Workflows are node graphs edited in the browser; billing is one set of nodes and graphs plugged into a general-purpose engine.

## Docs

Project documentation lives in [`.docs`](.docs). Read **Standards** before contributing; every change follows them. Then start with **Getting Started** and **Architecture**, and read the area you are working on.

| Doc                                               | What it covers                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [Standards](.docs/standards.md)                   | Engineering and code standards every change follows                                                     |
| [Getting Started](.docs/getting-started.md)       | Setup commands, the repository layout and the stack                                                     |
| [Overview](.docs/overview.md)                     | How it works end to end: engine, graphs from primitives, tenancy, the billing app from import to review |
| [Architecture](.docs/architecture.md)             | Apps, library layers, how a request and a run flow through the system                                   |
| [Tenancy and Access](.docs/tenancy-and-access.md) | Organizations, agencies, users, roles, permissions, invitations, guards, the agency picker              |
| [Workflow Engine](.docs/workflow-engine.md)       | Graphs, nodes, pins, durable runs, waits, child runs, version pinning                                   |
| [Overrides](.docs/overrides.md)                   | Graph and table overrides, roles, contracts, compare, showing changes                                   |
| [Workflows](.docs/workflows.md)                   | Records, events, service nodes and every billing workflow, stage and rule, and what comes next          |
| [EMS Billing Primer](.docs/ems-billing-primer.md) | How ambulance billing works: transactions, codes, Medicare rules, MVP checklist                         |
| [Clearinghouse](.docs/clearinghouse.md)           | The port, SFTP and real-time transports, connections, Waystar conventions, the mock                     |
| [Data Model](.docs/data-model.md)                 | Tables by area and the rules the database enforces                                                      |
| [Web App](.docs/web-app.md)                       | Routing, agency paths, API scoping, live updates, pages                                                 |
| [Testing](.docs/testing.md)                       | Unit tests and test kits                                                                                |
