import type { Db } from '@ugula/db';

export const isActiveMember = async (db: Db, userId: string, agencyId: string) =>
  (await db
    .selectFrom('users as u')
    .innerJoin('agencies as a', (j) =>
      j.on((eb) =>
        eb.or([
          eb('u.type', '=', 'platform'),
          eb('a.organization_id', '=', eb.ref('u.organization_id'))
        ])
      )
    )
    .innerJoin('organizations as o', 'o.id', 'a.organization_id')
    .select('u.id')
    .where('u.id', '=', userId)
    .where('a.id', '=', agencyId)
    .where('u.is_active', '=', true)
    .where('a.is_active', '=', true)
    .where('o.is_active', '=', true)
    .where((eb) =>
      eb.or([
        eb('u.type', '=', 'platform'),
        eb('u.is_owner', '=', true),
        eb.exists(
          eb
            .selectFrom('memberships as m')
            .select('m.id')
            .whereRef('m.user_id', '=', 'u.id')
            .whereRef('m.agency_id', '=', 'a.id')
        )
      ])
    )
    .executeTakeFirst()) !== undefined;
