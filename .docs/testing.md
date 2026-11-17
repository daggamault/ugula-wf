# Testing

- Every source file with logic has a colocated `<name>.test.ts` using `node:test` and `node:assert/strict`.
- `pnpm test` runs every package, and `libs/boundaries.test.ts`; `pnpm typecheck` and `pnpm check` must also pass before a commit.
- Test kits ship from `/testing` entries: `@ugula/nemsis/testing` (`fixtureUrl` locates the shared NEMSIS fixtures by name), `@ugula/db/testing` (`createRecordingDb` records the SQL a query sends and returns canned rows), `@ugula/graph/testing` (`invokeNode` runs a node with the engine's checks), `@ugula/billing/testing`.
- API route tests use `withSession(routes, testAccess(permissions))` from `apps/api/src/shared/testing.ts` to act as a signed-in user with chosen permissions.
- Web component tests render with Testing Library on happy-dom through `apps/web/src/shared/testing-dom.ts`, query by role and accessible name, and drive the UI with `userEvent`.
- Never hand a DOM node to `assert.equal` or `assert.deepEqual`: a failing assertion inspects it, which walks the whole happy-dom window for minutes and gigabytes. Assert on a boolean (`assert.ok(!screen.queryByRole(...))`, `assert.ok(document.activeElement === button)`) or on text.
