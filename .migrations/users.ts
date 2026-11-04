import { PERMISSIONS } from '@ugula/access';
import { type Database, USER_TYPES } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { normalizedEmail, oneOf, trimmed } from './checks.ts';

const buildUsersTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('is_owner', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('email', 'text', (col) => col.notNull().unique())
    .addColumn('first_name', 'text', (col) => col.notNull())
    .addColumn('last_name', 'text', (col) => col.notNull())
    .addColumn('password_hash', 'text', (col) => col.notNull())
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('users_id_organization_id_unique', ['id', 'organization_id'])
    .addCheckConstraint('users_type_check', oneOf('type', USER_TYPES))
    .addCheckConstraint('users_email_check', normalizedEmail('email'))
    .addCheckConstraint('users_first_name_check', trimmed('first_name'))
    .addCheckConstraint('users_last_name_check', trimmed('last_name'))
    .addCheckConstraint(
      'users_organization_id_check',
      sql`(type = 'platform' and organization_id is null and not is_owner) or (type = 'organization' and organization_id is not null)`
    );

const buildRolesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('roles')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('agency_id', 'uuid', (col) =>
      col.notNull().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('roles_agency_id_name_unique', ['agency_id', 'name'])
    .addUniqueConstraint('roles_id_agency_id_unique', ['id', 'agency_id'])
    .addCheckConstraint('roles_name_check', trimmed('name'));

const buildRolePermissionsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('role_permissions')
    .addColumn('role_id', 'uuid', (col) =>
      col.notNull().references('roles.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('permission', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('role_permissions_pkey', ['role_id', 'permission'])
    .addCheckConstraint('role_permissions_permission_check', oneOf('permission', PERMISSIONS));

const buildMembershipsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('memberships')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('organization_id', 'uuid', (col) => col.notNull())
    .addColumn('user_id', 'uuid', (col) => col.notNull())
    .addColumn('agency_id', 'uuid', (col) => col.notNull())
    .addColumn('role_id', 'uuid', (col) => col.notNull())
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('memberships_agency_id_user_id_unique', ['agency_id', 'user_id'])
    .addForeignKeyConstraint(
      'memberships_user_fkey',
      ['user_id', 'organization_id'],
      'users',
      ['id', 'organization_id'],
      (fk) => fk.onDelete('cascade').onUpdate('cascade')
    )
    .addForeignKeyConstraint(
      'memberships_agency_fkey',
      ['agency_id', 'organization_id'],
      'agencies',
      ['id', 'organization_id'],
      (fk) => fk.onDelete('cascade').onUpdate('cascade')
    )
    .addForeignKeyConstraint(
      'memberships_role_fkey',
      ['role_id', 'agency_id'],
      'roles',
      ['id', 'agency_id'],
      (fk) => fk.onDelete('restrict').onUpdate('cascade')
    );

const buildInvitationsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('invitations')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('agency_id', 'uuid', (col) =>
      col.notNull().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('role_id', 'uuid', (col) => col.notNull())
    .addColumn('email', 'text', (col) => col.notNull())
    .addColumn('first_name', 'text', (col) => col.notNull())
    .addColumn('last_name', 'text', (col) => col.notNull())
    .addColumn('token_hash', 'text', (col) => col.notNull().unique())
    .addColumn('invited_by', 'uuid', (col) =>
      col.references('users.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('invitations_agency_id_email_unique', ['agency_id', 'email'])
    .addForeignKeyConstraint(
      'invitations_role_fkey',
      ['role_id', 'agency_id'],
      'roles',
      ['id', 'agency_id'],
      (fk) => fk.onDelete('cascade').onUpdate('cascade')
    )
    .addCheckConstraint('invitations_email_check', normalizedEmail('email'))
    .addCheckConstraint('invitations_first_name_check', trimmed('first_name'))
    .addCheckConstraint('invitations_last_name_check', trimmed('last_name'));

const buildPasswordTokensTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('password_tokens')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('token_hash', 'text', (col) => col.notNull().unique())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`));

const buildIndexes = (db: Kysely<Database>) => [
  db.schema.createIndex('idx_users_organization_id').on('users').column('organization_id'),
  db.schema.createIndex('idx_memberships_user_id').on('memberships').column('user_id'),
  db.schema.createIndex('idx_memberships_role_id').on('memberships').column('role_id'),
  db.schema.createIndex('idx_invitations_role_id').on('invitations').column('role_id'),
  db.schema.createIndex('idx_invitations_invited_by').on('invitations').column('invited_by'),
  db.schema.createIndex('idx_password_tokens_user_id').on('password_tokens').column('user_id')
];

export const createUsersTables = async (db: Kysely<Database>) => {
  await buildUsersTable(db).execute();
  await buildRolesTable(db).execute();
  await buildRolePermissionsTable(db).execute();
  await buildMembershipsTable(db).execute();
  await buildInvitationsTable(db).execute();
  await buildPasswordTokensTable(db).execute();
  for (const index of buildIndexes(db)) await index.execute();
};
