import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

type SeedUserInput = {
  organizationId: string;
  email: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
  isOwner: boolean;
};

export const upsertUser = (db: Kysely<Database>, input: SeedUserInput) =>
  db
    .insertInto('users')
    .values({
      type: 'organization',
      organization_id: input.organizationId,
      is_owner: input.isOwner,
      email: input.email.toLowerCase(),
      first_name: input.firstName,
      last_name: input.lastName,
      password_hash: input.passwordHash,
      is_active: true
    })
    .onConflict((oc) =>
      oc.column('email').doUpdateSet({
        type: 'organization',
        organization_id: input.organizationId,
        is_owner: input.isOwner,
        password_hash: input.passwordHash,
        is_active: true,
        updated_at: sql`now()`
      })
    )
    .returning('id')
    .executeTakeFirstOrThrow();

export const upsertMembership = async (
  db: Kysely<Database>,
  input: { organizationId: string; agencyId: string; userId: string; roleId: string }
) => {
  await db
    .insertInto('memberships')
    .values({
      organization_id: input.organizationId,
      agency_id: input.agencyId,
      user_id: input.userId,
      role_id: input.roleId
    })
    .onConflict((oc) => oc.columns(['agency_id', 'user_id']).doUpdateSet({ role_id: input.roleId }))
    .execute();
};
