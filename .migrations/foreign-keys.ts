import { sql } from 'kysely';

type AgencyForeignKey = {
  table: string;
  column: string;
  references: string;
};

export const agencySetNullForeignKey = ({ table, column, references }: AgencyForeignKey) =>
  sql`alter table ${sql.table(table)}
  add constraint ${sql.id(`${table}_${column}_fkey`)}
  foreign key (agency_id, ${sql.id(column)}) references ${sql.table(references)} (agency_id, id)
  on delete set null (${sql.id(column)}) on update cascade`;

export const agencyNoActionForeignKey = ({ table, column, references }: AgencyForeignKey) =>
  sql`alter table ${sql.table(table)}
  add constraint ${sql.id(`${table}_${column}_fkey`)}
  foreign key (agency_id, ${sql.id(column)}) references ${sql.table(references)} (agency_id, id)
  on delete no action on update cascade`;
