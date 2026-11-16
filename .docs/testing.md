# Testing

## Unit tests

- Every source file with logic has a colocated `<name>.test.ts` using `node:test` and `node:assert/strict`.
- `pnpm test` runs every package, and `libs/boundaries.test.ts`; `pnpm typecheck` and `pnpm check` must also pass before a commit.
- Test kits ship from `/testing` entries: `@ugula/nemsis/testing` (`fixtureUrl` locates the shared NEMSIS fixtures by name), `@ugula/db/testing` (`createRecordingDb` records the SQL a query sends and returns canned rows), `@ugula/graph/testing` (`invokeNode` runs a node with the engine's checks), `@ugula/billing/testing`.
- API route tests use `withSession(routes, testAccess(permissions))` from `apps/api/src/shared/testing.ts` to act as a signed-in user with chosen permissions.

## End-to-end suites

`pnpm e2e` (`apps/web/e2e/run.ts`) leaves the dev database and stack alone. It resets `<DB_NAME>_e2e` with `pnpm db:reset`, cloned from the same reference database as dev, then starts its own stack with `pnpm dev` on every dev port plus 100 (web 3100, api 3101, sse 3102, the mock clearinghouse 2323 and 2324) and the `<S3_BUCKET>-e2e` bucket, writing its output to `.cache/e2e-stack.log`. It runs the suites once the api, sse and web answer, and stops the stack afterwards. Pass suite paths to run only those (`pnpm e2e e2e/billing.e2e.ts`). Redis and the models are shared with dev. The suites open the e2e web app in `E2E_BROWSER_CHANNEL` (`msedge` by default, or `chrome` or `chromium`); every step waits at most `E2E_STEP_MS` (15s by default) and every workflow stage at most `E2E_FLOW_MS` (5 minutes by default). Suites run in parallel, one process each, and work with synthetic NEMSIS and X12 fixtures only.

| Suite                                                                     | Covers                                                                                                                           |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `billing.e2e.ts`                                                          | Import to payment: review, 270 and 271, the 837P, 999, a 277CA rejection and resubmission, the 835                               |
| `classifications.e2e.ts`, `service-levels.e2e.ts`, `documentation.e2e.ts` | One fixture per billing scenario, each down to the 837P it files (or why it files none)                                          |
| `coverage-rules.e2e.ts`                                                   | QL, GM, A0888, MSP (work injury and auto accident: the primary, then Medicare with SBR05) and a contract facility                |
| `imports.e2e.ts`                                                          | Multi-report files and corrected reports, applied or acknowledged                                                                |
| `remittance.e2e.ts`                                                       | 999 and TA1 rejections, a provider-level 277CA, 277 claim status, patient share, secondary COB, crossover, reversal, refund, PLB |
| `denials.e2e.ts`                                                          | Work Denial: replacement, void, reopening, appeal, another payer, the patient, write-off                                         |
| `intake.e2e.ts`                                                           | Confirm patient, Match payer, Recover draft, GA and GZ                                                                           |
| `schedules.e2e.ts`                                                        | Deadlines, facility invoices, document chases, a facility as the responsible party, Restart Payer Cycle                          |
| `claims.e2e.ts`                                                           | Work queue, search, tasks, documents, records requests, payments, patients, sign-in and sign-out                                 |
| `clearinghouse.e2e.ts`                                                    | The live mock clearinghouse: SFTP 837P, then its 999, 277CA and 835; REJECT, INACTIVE, ADVANTAGE and INPATIENT members           |
| `workflows.e2e.ts`                                                        | Editing, overriding and running workflows, the customization map                                                                 |
| `admin.e2e.ts`                                                            | Fees, payers, facilities, settings, the clearinghouse connection, tables and overrides, reports, payer files                     |
| `access.e2e.ts`                                                           | Roles, invitations and password links, and what a limited role can see and do                                                    |

### Isolation

- Suites work in the **Development North** agency, whose clearinghouse connection they keep **paused** (`signIn()`), so nothing is exchanged with the mock and every acknowledgment and remittance is a file the test uploads. Two work in **Development**, which uses the server default connection to the mock: `clearinghouse.e2e.ts`, which waits for the mock's answers, and `schedules.e2e.ts`, whose Watch Deadlines and Invoice Facilities runs scan the whole agency and would otherwise open tasks on other suites' claims.
- `uniqueId` gives each run and suite its own numbers. `encounter()` (in `shared/claims.ts`) swaps in a unique PCR number, prefixes every patient, insured and signer name with a tag drawn from it (`tagged`), and gives each member ID a unique tail (or a `memberPrefix` such as `REJECT` for the mock), so no two encounters share a patient or an eligibility answer. A payer can be renamed per run (`payers`) to make the payer directory ask.
- Tasks are worked by plan: `work`, `workTask` and `workUntil` take the tasks expected in order with the outcome to choose, and fail as soon as the claim waits on a task that is not in the plan.
- Helpers in `apps/web/e2e/shared` scope navigation (`go`) and API calls (`api`, `send`, `apiPath`) to the agency the session opened; `x12.ts` builds 271, 999, TA1, 277CA, 277 and 835 files on `@ugula/billing/mock`, with 835 service lines matched to the 837P lines they pay. Never commit real patient data.
