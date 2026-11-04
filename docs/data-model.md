# Data Model

Postgres schema, created by `.migrations/*.ts` and typed in `libs/data/db/src/schema.ts`. Enumerations are defined once in code and enforced with `CHECK` constraints. Agency-scoped tables carry `agency_id` and use composite foreign keys `(agency_id, x)` so a row can only point at rows of the same agency.

## Tenancy and access

| Table                       | Holds                                                               |
| --------------------------- | ------------------------------------------------------------------- |
| `organizations`             | Customers                                                           |
| `agencies`                  | Billing tenants, each in one organization; SFTP import credentials  |
| `users`                     | Platform and organization users; `is_owner` for organization owners |
| `roles`, `role_permissions` | Custom roles per agency and their permissions                       |
| `memberships`               | One role per user per agency, tied to the same organization         |
| `invitations`               | Pending invitations (token hash, role, expiry)                      |
| `password_tokens`           | One-time password links                                             |

## Workflows

| Table                 | Holds                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `graphs`              | One row per graph and scope: system (no organization), organization, or agency                      |
| `graph_versions`      | Immutable published versions and one draft per graph; `contract`, `dependencies`, `base_version_id` |
| `workflow_runs`       | Runs, their state, status, parent links and leases                                                  |
| `workflow_run_graphs` | The graph versions each run pinned at start                                                         |
| `workflow_run_steps`  | Trace of every executed node                                                                        |
| `signals`             | Counted signals runs wait on                                                                        |
| `tasks`               | Human tasks, their queue, assignee (a member of the agency) and outcome                             |

## Billing

| Table                                                        | Holds                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------- |
| `imports`, `import_reports`                                  | NEMSIS files and what each report became                            |
| `patients`                                                   | Patients, matched across reports                                    |
| `claims`                                                     | One per PCR, with trip, service, documentation and status           |
| `claim_runs`                                                 | Runs working each claim                                             |
| `claim_lines`, `claim_coverages`, `claim_diagnoses`          | Service lines, payers in order, ICD-10 codes                        |
| `claim_events`, `claim_event_adjustments`                    | The ledger: submissions, payments, adjustments, denials, write-offs |
| `claim_balances`                                             | View of balances per claim                                          |
| `claim_batches`                                              | 837P files and control numbers                                      |
| `payer_files`, `payer_file_items`, `clearinghouse_downloads` | Inbound 835/999/277CA/271 files, their lines and outcomes           |
| `payers`, `payer_aliases`, `payer_suggestions`               | The payer directory, learned names, model suggestions               |
| `fee_schedules`                                              | Default and payer prices per HCPCS code                             |
| `billing_profiles`                                           | The agency's billing identity and clearinghouse IDs                 |
| `notifications`, `notification_states`                       | The notification bell per user and agency                           |

## Reference data

`gnis_places` (USGS place names for NEMSIS city codes), `nemsis_elements` and `nemsis_codes` (element names and code descriptions from the NEMSIS 3.5 schema).

## Development workflow

Migrations are edited in place during development. `pnpm db:migrate` drops and recreates the schema; `pnpm db:seed:dev` loads reference data, system graphs, the development organization with two agencies, built-in roles, the dev owner, demo fees and payers.
