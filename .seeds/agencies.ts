import { BUILT_IN_ROLES } from '@ugula/access';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

type SeedAgencyInput = {
  organizationId: string;
  name: string;
  slug: string;
  sftpUsername: string | null;
  sftpPasswordHash: string | null;
};

export const upsertOrganization = (db: Kysely<Database>, name: string) =>
  db
    .insertInto('organizations')
    .values({ name, is_active: true })
    .onConflict((oc) => oc.column('name').doUpdateSet({ is_active: true, updated_at: sql`now()` }))
    .returning('id')
    .executeTakeFirstOrThrow();

export const upsertAgency = (db: Kysely<Database>, input: SeedAgencyInput) =>
  db
    .insertInto('agencies')
    .values({
      organization_id: input.organizationId,
      name: input.name,
      slug: input.slug,
      sftp_username: input.sftpUsername,
      sftp_password_hash: input.sftpPasswordHash,
      is_active: true
    })
    .onConflict((oc) =>
      oc.column('slug').doUpdateSet({
        name: input.name,
        sftp_username: input.sftpUsername,
        sftp_password_hash: input.sftpPasswordHash,
        is_active: true,
        updated_at: sql`now()`
      })
    )
    .returning(['id', 'organization_id'])
    .executeTakeFirstOrThrow();

export const upsertBuiltInRoles = async (db: Kysely<Database>, agencyId: string) => {
  const ids = new Map<string, string>();
  for (const role of BUILT_IN_ROLES) {
    const { id } = await db
      .insertInto('roles')
      .values({ agency_id: agencyId, name: role.name })
      .onConflict((oc) => oc.columns(['agency_id', 'name']).doUpdateSet({ updated_at: sql`now()` }))
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .deleteFrom('role_permissions')
      .where('role_id', '=', id)
      .where('permission', 'not in', [...role.permissions])
      .execute();
    await db
      .insertInto('role_permissions')
      .values(role.permissions.map((permission) => ({ role_id: id, permission })))
      .onConflict((oc) => oc.doNothing())
      .execute();
    ids.set(role.name, id);
  }
  return ids;
};
