# Tenancy and Access

## Organizations and agencies

- An **organization** is the customer: an EMS service, a county, or a billing company.
- An **agency** belongs to one organization and owns the billing data: claims, patients, imports, payer files, payers, fees, the billing profile and tasks.
- Workflows and shared tables can be customized for the whole organization (owners only) or for one agency (see [Overrides](overrides.md)). In an agency, `workflows:update` may override rules, Agency Rule slots and tables; `workflows:manage` is needed for stages and workflows.

## Users

| Type                              | Who                           | Access                                                                       |
| --------------------------------- | ----------------------------- | ---------------------------------------------------------------------------- |
| `platform`                        | Ugula staff                   | Every agency, every permission                                               |
| `organization` owner (`is_owner`) | The customer's administrators | Every agency in their organization, every permission, organization workflows |
| `organization` member             | Everyone else                 | Only agencies they have a membership in, with that membership's role         |

A user belongs to at most one organization. Email addresses are unique and stored lowercase.

## Roles and permissions

- Permissions are `resource:action` strings defined once in `libs/domain/access/src/permissions.ts` and checked by a database `CHECK` constraint.
- Roles are custom per agency (`roles`, `role_permissions`). Every agency starts with the built-in roles below (`BUILT_IN_ROLES` in `@ugula/access`), which it can change afterwards. Whatever creates an agency calls `saveBuiltInRoles` from `@ugula/db` in the same transaction; seeding calls it too and so resets the built-in roles to their definitions.

| Built-in role   | Holds                                                                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin           | Every permission                                                                                                                                                                                      |
| Billing Manager | Everything on patients, imports, claims (`claims:approve` included), tasks, payer files, payers, facilities, fees, reports and runs; reading settings, users, roles and workflows; `workflows:update` |
| Biller          | Create, read and update on patients, imports, claims, tasks and payer files (not `claims:approve`); reading everything else                                                                           |
| Viewer          | Reading everything                                                                                                                                                                                    |

- A membership (`memberships`) gives one user one role in one agency. Composite foreign keys make it impossible to join an agency or role outside your organization.

| Resource    | Actions                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------- |
| settings    | read, update                                                                                  |
| users       | create, read, update, delete                                                                  |
| roles       | create, read, update, delete                                                                  |
| patients    | read                                                                                          |
| imports     | create, read                                                                                  |
| claims      | read, update, approve (refunds, write-offs and collections above the Claim Policy thresholds) |
| tasks       | read, update                                                                                  |
| payer_files | create, read                                                                                  |
| payers      | create, read, update, delete (the payer directory)                                            |
| facilities  | create, read, update, delete (facilities that pay for the trips they are responsible for)     |
| fees        | create, read, update, delete                                                                  |
| reports     | read                                                                                          |
| workflows   | read, update (rules, tables, agency rule slots), manage (stages, workflows)                   |
| runs        | create (start runs, upload their files), read, update (cancel runs)                           |

Saving a payer or fee adds it or changes the one with the same name or code, so it needs `create` when it is new and `update` when it exists; the write itself checks which one happens, so a race cannot slip past either.

### Tasks that need a permission

A human task can name the permission whoever completes it needs (`permission` in the task config, stored on `tasks.permission`). The API refuses to complete it without that permission (403) and the task page explains why its outcomes are disabled. **Approve Refund**, **Approve Write-Off** and **Approve Collections** need `claims:approve`, which Admin and Billing Manager hold and Biller does not. A separate `claims:approve` was chosen over reusing `claims:update` so that the billers who work claims cannot approve money leaving the agency or balances written off, and over a `refunds:approve` so one approval right covers refunds, large write-offs and collections placements alike.

### Rules that prevent escalation

- You can only create, change, give or delete a role whose permissions you all hold (`canGrant`).
- You cannot change or remove a user whose role has permissions you do not hold, or yourself.
- An agency always keeps at least one active user who can manage users; changes that would remove the last one fail with 409. Deactivated users do not count.
- Membership changes lock the agency row so concurrent edits cannot race past these checks.

## Invitations and passwords

- `POST /api/agencies/:id/invitations` creates an invitation and returns a one-time link (`/invitation?token=…`) valid for 7 days. Only the token's SHA-256 hash is stored.
- Opening the link shows the agency and role. A new person chooses a password; someone who already has an account in the organization enters theirs, throttled like sign-in. Accepting consumes the invitation and creates the membership in one transaction, so a link works once, and never changes the role of someone already in the agency; then it signs them in.
- Token pages drop the token from the address bar as soon as they read it, send it only in request bodies (`POST /api/auth/invitation/preview`) and the web app sends no referrer. Sign-in spends the same password work on unknown emails as on known ones.
- `POST /api/agencies/:id/users/:userId/password-link` returns a 24-hour `/password?token=…` link and voids the user's earlier ones. A password covers every agency, so only an owner, or someone holding every permission the user has in each of their agencies, can make one. Setting a password ends all of the user's sessions.
- The invite and user pages pick roles from `GET /api/agencies/:id/users/roles`, which needs only `users:read`. A role pending invitations still give cannot be deleted.
- Links are shown to the inviter to copy; email delivery is not built yet.

## Guards

| Guard                 | File                            | Does                                                           |
| --------------------- | ------------------------------- | -------------------------------------------------------------- |
| `requireAuth`         | `apps/api/src/shared/auth.ts`   | 401 without a valid session                                    |
| `requireAgencyAccess` | `apps/api/src/shared/access.ts` | 404 unless the user may open `:agencyId`; sets `c.var.access`  |
| `guardMethods`        | same                            | Maps GET/POST/PUT/DELETE on a router to permissions            |
| `requirePermission`   | same                            | One permission for one route                                   |
| `canEditScope`        | `apps/api/src/shared/scopes.ts` | Who may edit organization or agency graphs and tables, by role |

Both checks come from `libs/data/db/src/access.ts`: `findAgencyAccess` for the API and `canOpenAgency`, the same query, for the SSE stream (`/events?agency=<id>`) before it streams an agency's events.

## In the browser

- URLs carry the agency: `/agencies/:agencyId/claims`. Links inside the app stay agency-relative (`/claims`) and the router adds the prefix.
- After sign-in the app opens the last agency used, the only agency, or asks you to choose one.
- The **agency picker** at the top of the sidebar switches agencies.
- `useCan()` hides navigation and actions the role cannot use; the API enforces the same rules.
