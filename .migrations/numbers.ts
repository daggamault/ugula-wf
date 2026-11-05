import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

const DAILY_NUMBER_PATTERN = '^[0-9]{8}-[0-9]{4,}$';

const buildDailyNumbersTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('daily_numbers')
    .addColumn('agency_id', 'uuid', (col) =>
      col.notNull().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('day', 'date', (col) => col.notNull())
    .addColumn('last', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('daily_numbers_pkey', ['agency_id', 'kind', 'day'])
    .addCheckConstraint('daily_numbers_last_check', sql`last >= 1`);

const nextDailyNumberFunction = sql`
  create function next_daily_number(p_agency_id uuid, p_kind text) returns text
  language plpgsql as $$
  declare
    v_day date;
    v_last integer;
  begin
    v_day := (now() at time zone coalesce(
      (select bp.time_zone from billing_profiles bp where bp.agency_id = p_agency_id), 'UTC'
    ))::date;
    insert into daily_numbers as d (agency_id, kind, day, last)
    values (p_agency_id, p_kind, v_day, 1)
    on conflict (agency_id, kind, day) do update set last = d.last + 1
    returning d.last into v_last;
    return to_char(v_day, 'YYYYMMDD') || '-' || lpad(v_last::text, greatest(4, length(v_last::text)), '0');
  end;
  $$`;

const assignDailyNumberFunction = sql`
  create function assign_daily_number() returns trigger language plpgsql as $$
  begin
    if tg_table_name = 'import_reports' then
      new.number := next_daily_number(
        (select i.agency_id from imports i where i.id = new.import_id), tg_argv[0]
      );
    else
      new.number := next_daily_number(new.agency_id, tg_argv[0]);
    end if;
    return new;
  end;
  $$`;

export const DAILY_NUMBER_FUNCTIONS = ['assign_daily_number', 'next_daily_number'] as const;

export const createDailyNumbers = async (db: Kysely<Database>) => {
  await buildDailyNumbersTable(db).execute();
  await nextDailyNumberFunction.execute(db);
  await assignDailyNumberFunction.execute(db);
};

export const dailyNumberTrigger = (table: 'claims' | 'patients' | 'import_reports', kind: string) =>
  sql`create trigger ${sql.id(`${table}_number`)}
  before insert on ${sql.table(table)}
  for each row execute function assign_daily_number(${sql.lit(kind)})`;

export const dailyNumberCheck = sql`number ~ ${sql.lit(DAILY_NUMBER_PATTERN)}`;
