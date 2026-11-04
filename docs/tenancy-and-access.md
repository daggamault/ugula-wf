# Tenancy and Access

## Organizations and agencies

- An **organization** is the customer: an EMS service, a county, or a billing company.
- An **agency** belongs to one organization and owns the billing data: claims, patients, imports, payer files, payers, fees, the billing profile and tasks.
- Workflows can be customized for the whole organization or for one agency (see [Overrides](overrides.md)).

## Users

| Type                              | Who                           | Access                                                                       |
| --------------------------------- | ----------------------------- | ---------------------------------------------------------------------------- |
| `platform`                        | Ugula staff                   | Every agency, every permission                                               |
| `organization` owner (`is_owner`) | The customer's administrators | Every agency in their organization, every permission, organization workflows |
| `organization` member             | Everyone else                 | Only agencies they have a membership in, with that membership's role         |

A user belongs to at most one organization. Email addresses are unique and stored lowercase.

## Roles and permissions

- Permissions are `resource:action` strings defined once in `libs/domain/access/src/permissions.ts` and checked by a database `CHECK` constraint.
- Roles are custom per agency (`roles`, `role_permissions`). Every agency is seeded with **Admin**, **Billing Manager**, **Biller** and **Viewer** (`BUILT_IN_ROLES`), which agencies can change.
- A membership (`memberships`) gives one user one role in one agency. Composite foreign keys make it impossible to join an agency or role outside your organization.

| Resource    | Actions                                                                            |
| ----------- | ---------------------------------------------------------------------------------- |
| settings    | read, update                                                                       |
| users       | create, read, update, delete                                                       |
| roles       | create, read, update, delete                                                       |
| patients    | read, update                                                                       |
| imports     | create, read                                                                       |
| claims      | read, update                                                                       |
| tasks       | read, update                                                                       |
| payer_files | create, read                                                                       |
| payers      | create, read, update, delete                                                       |
| fees        | create, read, update, delete                                                       |
| reports     | read                                                                               |
| workflows   | read, update (rules, tables, agency slots), manage (stages, workflows, new graphs) |
| runs        | create, read, update                                                               |

### Rules that prevent escalation

- You can only create, change, give or delete a role whose permissions you all hold (`canGrant`).
- You cannot change or remove a user whose role has permissions you do not hold, or yourself.
- An agency always keeps at least one user who can manage users; changes that would remove the last one fail with 409.
- Membership changes lock the agency row so concurrent edits cannot race past these checks.

## Invitations and passwords

- `POST /api/agencies/:id/invitations` creates an invitation and returns a one-time link (`/invitation?token=…`) valid for 7 days. Only the token's SHA-256 hash is stored.
- Opening the link shows the agency and role. A new person chooses a password; someone who already has an account in the organization enters theirs. Accepting creates the membership and signs them in.
- `POST /api/agencies/:id/users/:userId/password-link` returns a 24-hour `/password?token=…` link. Setting a password ends all of the user's sessions.
- Links are shown to the inviter to copy; email delivery is not built yet.

## Guards

| Guard                 | File                                      | Does                                                          |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| `requireAuth`         | `apps/api/src/shared/auth.ts`             | 401 without a valid session                                   |
| `requireAgencyAccess` | `apps/api/src/shared/access.ts`           | 404 unless the user may open `:agencyId`; sets `c.var.access` |
| `guardMethods`        | same                                      | Maps GET/POST/PUT/DELETE on a router to permissions           |
| `requirePermission`   | same                                      | One permission for one route                                  |
| `canEditScope`        | `apps/api/src/features/graphs/service.ts` | Who may edit organization or agency graphs                    |

The SSE stream (`/events?agency=<id>`) runs the same membership check before streaming an agency's events.

## In the browser

- URLs carry the agency: `/agencies/:agencyId/claims`. Links inside the app stay agency-relative (`/claims`) and the router adds the prefix.
- After sign-in the app opens the last agency used, the only agency, or asks you to choose one.
- The **agency picker** at the top of the sidebar switches agencies.
- `useCan()` hides navigation and actions the role cannot use; the API enforces the same rules.
