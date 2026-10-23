import { isSamePerson, nameKey, type Patient, type PatientStore, sexOf } from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runTenant } from '../../shared/tenancy.ts';

const CANDIDATE_LIMIT = 50;

const COLUMNS = [
  'id',
  'first_name',
  'last_name',
  'birth_date',
  'gender',
  'address_line',
  'city',
  'state',
  'postal_code'
] as const;

type PatientRow = {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  gender: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
};

const toPatient = (r: PatientRow): Patient => ({
  id: r.id,
  firstName: r.first_name,
  lastName: r.last_name,
  birthDate: r.birth_date,
  gender: sexOf(r.gender),
  addressLine: r.address_line,
  city: r.city,
  state: r.state,
  postalCode: r.postal_code
});

export const createPatientStore = (db: Kysely<Database>): PatientStore => ({
  findCandidates: async (runId, { birthDate, lastNameKey, firstName }) => {
    if (!birthDate && !lastNameKey) return [];
    const rows = await db
      .selectFrom('patients')
      .select(COLUMNS)
      .where('tenant_id', '=', runTenant(db, runId))
      .where((eb) =>
        eb.or([
          ...(birthDate ? [eb('birth_date', '=', birthDate)] : []),
          ...(lastNameKey ? [sql<boolean>`last_name_key % ${lastNameKey}`] : [])
        ])
      )
      .orderBy(
        sql`2 * (birth_date is not distinct from ${birthDate}::date)::int + similarity(last_name_key, ${lastNameKey ?? ''}) + (lower(first_name) is not distinct from lower(${firstName}))::int`,
        'desc'
      )
      .orderBy('created_at')
      .limit(CANDIDATE_LIMIT)
      .execute();
    return rows.map(toPatient);
  },
  findPatient: async (runId, id) => {
    if (!isUuid(id)) return null;
    const row = await db
      .selectFrom('patients')
      .select(COLUMNS)
      .where('id', '=', id)
      .where('tenant_id', '=', runTenant(db, runId))
      .executeTakeFirst();
    return row ? toPatient(row) : null;
  },
  createPatient: (runId, sourceKey, p, reuseMatch) =>
    db.transaction().execute(async (tx) => {
      const lastNameKey = nameKey(p.lastName);
      const identity = `:${lastNameKey}:${p.birthDate}`;
      await sql`select pg_advisory_xact_lock(hashtextextended(tenant_id::text || ${identity}, 0)) from workflow_runs where id = ${runId}`.execute(
        tx
      );
      if (reuseMatch) {
        const rows = await tx
          .selectFrom('patients')
          .select(COLUMNS)
          .where('tenant_id', '=', runTenant(tx, runId))
          .where('last_name_key', '=', lastNameKey)
          .where('birth_date', '=', p.birthDate)
          .orderBy('created_at')
          .execute();
        const same = rows.map(toPatient).find((r) => isSamePerson(p, r));
        if (same) return same;
      }
      return toPatient(
        await tx
          .insertInto('patients')
          .values({
            tenant_id: runTenant(tx, runId),
            first_name: p.firstName,
            last_name: p.lastName,
            last_name_key: lastNameKey,
            birth_date: p.birthDate,
            gender: p.gender,
            address_line: p.addressLine,
            city: p.city,
            state: p.state,
            postal_code: p.postalCode,
            source_key: sourceKey
          })
          .onConflict((oc) =>
            oc
              .columns(['tenant_id', 'source_key'])
              .doUpdateSet({ updated_at: sql`patients.updated_at` })
          )
          .returning(COLUMNS)
          .executeTakeFirstOrThrow()
      );
    })
});
