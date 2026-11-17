import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { trimmed } from './checks.ts';
import { agencySetNullForeignKey } from './foreign-keys.ts';

export const ACCOUNTING_FUNCTIONS = ['set_claim_event_posted_on'] as const;

const buildDepositsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('deposits')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('agency_id', 'uuid', (col) =>
      col.notNull().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('trace_number', 'text', (col) => col.notNull())
    .addColumn('amount_cents', 'integer', (col) => col.notNull())
    .addColumn('deposited_on', 'date', (col) => col.notNull())
    .addColumn('payer_name', 'text')
    .addColumn('note', 'text')
    .addColumn('payer_file_id', 'uuid')
    .addColumn('created_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('deposits_agency_id_trace_number_unique', ['agency_id', 'trace_number'])
    .addUniqueConstraint('deposits_payer_file_id_unique', ['payer_file_id'])
    .addCheckConstraint('deposits_trace_number_check', trimmed('trace_number'))
    .addCheckConstraint('deposits_amount_cents_check', sql`amount_cents > 0`)
    .addCheckConstraint('deposits_payer_name_check', trimmed('payer_name'))
    .addCheckConstraint('deposits_note_check', trimmed('note'));

const buildAccountingPeriodsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('accounting_periods')
    .addColumn('agency_id', 'uuid', (col) =>
      col.notNull().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('period_on', 'date', (col) => col.notNull())
    .addColumn('closed_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('closed_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null').onUpdate('cascade')
    )
    .addPrimaryKeyConstraint('accounting_periods_pkey', ['agency_id', 'period_on'])
    .addCheckConstraint('accounting_periods_period_on_check', sql`extract(day from period_on) = 1`);

const buildAccountingIndexes = (db: Kysely<Database>) => [
  db.schema
    .createIndex('idx_deposits_agency_deposited_on')
    .on('deposits')
    .columns(['agency_id', 'deposited_on desc']),
  db.schema.createIndex('idx_deposits_created_by_id').on('deposits').column('created_by_id'),
  db.schema
    .createIndex('idx_accounting_periods_closed_by_id')
    .on('accounting_periods')
    .column('closed_by_id')
];

const postedOnFunction = sql`
  create function set_claim_event_posted_on() returns trigger language plpgsql as $$
  declare
    posted date := (new.created_at at time zone coalesce(
      (select bp.time_zone from billing_profiles bp where bp.agency_id = new.agency_id), 'UTC'))::date;
    month date := date_trunc('month', posted)::date;
  begin
    if exists (select 1 from accounting_periods p where p.agency_id = new.agency_id and p.period_on = month) then
      select min(p.period_on + interval '1 month')::date into posted
      from accounting_periods p
      where p.agency_id = new.agency_id and p.period_on >= month
        and not exists (
          select 1 from accounting_periods n
          where n.agency_id = p.agency_id and n.period_on = (p.period_on + interval '1 month')::date
        );
    end if;
    new.posted_on := posted;
    return new;
  end;
  $$`;

const postedOnTrigger = sql`
  create trigger claim_events_posted_on
  before insert on claim_events
  for each row execute function set_claim_event_posted_on()`;

export const createAccountingTables = async (db: Kysely<Database>) => {
  await buildDepositsTable(db).execute();
  await agencySetNullForeignKey({
    table: 'deposits',
    column: 'payer_file_id',
    references: 'payer_files'
  }).execute(db);
  await buildAccountingPeriodsTable(db).execute();
  for (const index of buildAccountingIndexes(db)) await index.execute();
  await postedOnFunction.execute(db);
  await postedOnTrigger.execute(db);
};
