import { agencyTimeZone, type Db } from '@ugula/db';
import type { SchedulePeriod } from '@ugula/graph';
import { sql } from 'kysely';

type DueSchedule = { every: SchedulePeriod; hour: number };

export const findDueOn = async (db: Db, agencyId: string, workflow: string, s: DueSchedule) => {
  const zone = agencyTimeZone(agencyId);
  const { rows } = await sql<{ fire_on: string }>`
    select z.period::date::text as fire_on
    from (
      select date_trunc(${s.every}, now() at time zone ${zone}) as period,
        now() at time zone ${zone} as local
    ) z
    where z.local >= z.period + make_interval(hours => ${s.hour}::int)
      and not exists (
        select 1 from schedule_runs r
        where r.agency_id = ${agencyId}::uuid and r.workflow = ${workflow}
          and r.fire_on = z.period::date
      )`.execute(db);
  return rows[0]?.fire_on ?? null;
};

export const claimScheduleRun = (db: Db, agencyId: string, workflow: string, fireOn: string) =>
  db
    .insertInto('schedule_runs')
    .values({ agency_id: agencyId, workflow, fire_on: fireOn })
    .onConflict((oc) => oc.doNothing())
    .returning('agency_id')
    .executeTakeFirst();
