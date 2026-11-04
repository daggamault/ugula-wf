# Overrides

Every built-in graph can be customized without code, for a whole organization or for one agency.

## Three levels

| Level        | Owner                                                            | Applies to                       |
| ------------ | ---------------------------------------------------------------- | -------------------------------- |
| System       | Ugula (seeded)                                                   | Everyone, unless overridden      |
| Organization | Organization owners                                              | Every agency in the organization |
| Agency       | Users with `workflows:update` (`workflows:manage` for workflows) | That agency only                 |

A run uses the **agency** copy if one is active and published, else the **organization** copy, else the **system** graph.

## Contracts

An override must keep the signature of the system graph it replaces: the same exec ins, exits, inputs and outputs with the same names, types and optionality. This is the **contract** (`contractOf`), stored on every version.

- Publishing an override whose contract differs from the newest system version fails.
- At run time an override applies only to the system version whose contract it matches. When Ugula ships a new system version with a different contract, older overrides stop applying (runs fall back to the system graph) until they are rebased, and the graph is marked **stale**.

## Lifecycle

| Action     | Endpoint                              | Notes                                                                                                                                                                            |
| ---------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Override   | `POST /graphs/:id/override { scope }` | Copies the newest published version of the graph you are looking at into a draft for the organization or agency. Records `base_version_id`. Re-enables a removed copy as it was. |
| Edit draft | `PUT /graphs/:id/draft`               | Validates against the catalog and the graphs visible to the agency                                                                                                               |
| Publish    | `POST /graphs/:id/publish`            | Checks issues and the contract; new runs use it immediately                                                                                                                      |
| Compare    | `GET /graphs/:id/compare`             | Returns your newest version, the base version it was copied from and the base's newest version, and whether the base changed                                                     |
| Rebase     | `POST /graphs/:id/rebase { mode }`    | `keep` keeps your definition and marks it as based on the newest base; `reset` replaces your draft with the newest base                                                          |
| Remove     | `DELETE /graphs/:id`                  | Turns an override off (runs go back to the level below); a custom graph that overrides nothing is deleted                                                                        |

Runs that already started keep the versions they pinned; publishing or removing an override never changes them.

## Scope resolution in SQL

`libs/data/db/src/graph-versions.ts` resolves `key@version` for an agency:

1. Active graphs with that key that are system, the agency's organization (agency null), or the agency.
2. For organization and agency graphs, the newest published version whose contract equals the requested system version's contract (or the exact version for custom graphs with no system graph).
3. Agency first, then organization, then system.

## Planned (see [Workflow Architecture Review](workflow-architecture.md))

- **Agency rule slots**: empty pass-through subworkflows after base rules, so most changes need no copy of the base.
- **Tables as assets**: decision and lookup tables overridable as forms without copying the graph.
- **Custom accent**: changed nodes and overridden subworkflows highlighted in the editor, with a three-pane compare and Apply Base Changes.
- **Role tiers**: rules, tables and slots for `workflows:update`; stages and workflows for `workflows:manage`.
