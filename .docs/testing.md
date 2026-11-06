# Testing

## Unit tests

- Every source file with logic has a colocated `<name>.test.ts` using `node:test` and `node:assert/strict`.
- `pnpm test` runs every package, `libs/boundaries.test.ts` and the mock clearinghouse tests in `.dev`; `pnpm typecheck` and `pnpm check` must also pass before a commit.
- Test kits ship from `/testing` entries: `@ugula/db/testing` (`createRecordingDb` records the SQL a query sends and returns canned rows), `@ugula/graph/testing` (`invokeNode` runs a node with the engine's checks), `@ugula/billing/testing`.
- API route tests use `withSession(routes, testAccess(permissions))` from `apps/api/src/shared/testing.ts` to act as a signed-in user with chosen permissions.

## End-to-end suites

`pnpm e2e` drives the real app in a headless browser against a running stack. It opens `E2E_WEB_URL` (`http://localhost:3000` by default) in `E2E_BROWSER_CHANNEL` (`msedge` by default, or `chrome` or `chromium`); every step waits at most `E2E_STEP_MS` (15s by default) and every workflow stage at most `E2E_FLOW_MS` (5 minutes by default). Each suite signs in, opens the Development agency and works through one area with synthetic NEMSIS and X12 fixtures:

| Suite                                                                     | Covers                                           |
| ------------------------------------------------------------------------- | ------------------------------------------------ |
| `billing.e2e.ts`                                                          | Import to payment, down to the 837P              |
| `classifications.e2e.ts`, `service-levels.e2e.ts`, `documentation.e2e.ts` | One fixture per billing scenario                 |
| `coverage-rules.e2e.ts`                                                   | QL, GM, A0888, MSP order and a contract facility |
| `claims.e2e.ts`                                                           | Work queue, search, tasks, sign-in and sign-out  |
| `imports.e2e.ts`                                                          | Multi-report files and corrected reports         |
| `workflows.e2e.ts`                                                        | Editing, overriding and running workflows        |
| `admin.e2e.ts`                                                            | Fees, payers, settings, reports                  |

Helpers in `.e2e/shared/session.ts` scope navigation (`go`) and API reads (`api`, `apiPath`) to the agency the session opened. Never commit real patient data.
