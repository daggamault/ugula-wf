import {
  type ColumnType,
  DummyDriver,
  type Generated,
  Kysely,
  PostgresAdapter,
  PostgresDialect,
  PostgresIntrospector,
  PostgresQueryCompiler
} from 'kysely';
import { Pool, type PoolConfig } from 'pg';

export type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export type TenantsTable = {
  id: Generated<string>;
  name: string;
  slug: string;
  sftp_username: string | null;
  sftp_password_hash: string | null;
  is_active: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type UsersTable = {
  id: Generated<string>;
  tenant_id: string;
  email: string;
  password_hash: string;
  is_active: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type Database = {
  tenants: TenantsTable;
  users: UsersTable;
};

export type Db = Kysely<Database>;

export const createDb = (config: PoolConfig): Db =>
  new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool(config)
    })
  });

export const createDummyDb = (): Db =>
  new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  });
