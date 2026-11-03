import { sql } from 'kysely';

type TenantForeignKey = {
  table: string;
  column: string;
  references: string;
};

export const tenantSetNullForeignKey = ({ table, column, references }: TenantForeignKey) =>
  sql`alter table ${sql.table(table)}
  add constraint ${sql.id(`${table}_${column}_fkey`)}
  foreign key (tenant_id, ${sql.id(column)}) references ${sql.table(references)} (tenant_id, id)
  on delete set null (${sql.id(column)}) on update cascade`;
