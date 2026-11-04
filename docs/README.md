# Ugula Docs

How the pieces of Ugula fit together. Start with **Architecture**, then read the area you are working on.

| Doc                                                      | What it covers                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [Architecture](architecture.md)                          | Apps, library layers, how a request and a run flow through the system                      |
| [Tenancy and Access](tenancy-and-access.md)              | Organizations, agencies, users, roles, permissions, invitations, guards, the agency picker |
| [Workflow Engine](workflow-engine.md)                    | Graphs, nodes, pins, durable runs, waits, child runs, version pinning                      |
| [Overrides](overrides.md)                                | System, organization and agency graphs; contracts; resolution; compare and rebase          |
| [Billing Workflows](billing-workflows.md)                | Every billing workflow and subworkflow today, and the target catalog                       |
| [EMS Billing Primer](ems-billing-primer.md)              | How ambulance billing works: transactions, codes, Medicare rules, MVP checklist            |
| [Clearinghouse](clearinghouse.md)                        | SFTP exchange, the mock, Waystar conventions, real-time plans                              |
| [Data Model](data-model.md)                              | Tables by area and the rules the database enforces                                         |
| [Web App](web-app.md)                                    | Routing, agency paths, API scoping, live updates, pages                                    |
| [Testing](testing.md)                                    | Unit tests, test kits, end-to-end suites                                                   |
| [Workflow Architecture Review](workflow-architecture.md) | The critical review and target design that drives the roadmap                              |

The [README](../README.md) at the root has setup commands and the engineering standards every change follows.
