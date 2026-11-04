import type { Db } from '@ugula/db';
import { fail, ok } from '../../shared/result.ts';
import { deleteConnection, findConnection, updateConnection, upsertConnection } from './queries.ts';
import type { ConnectionInput } from './schemas.ts';

type Seal = (secret: string, agencyId: string) => string;

type ConnectionServiceDeps = { db: Db; seal: Seal | null };

export const NO_SECRET_KEY =
  'This server cannot store clearinghouse passwords until CLEARINGHOUSE_SECRET_KEY is set';

export const createConnectionService = ({ db, seal }: ConnectionServiceDeps) => ({
  find: async (agencyId: string) =>
    ok({
      connection: (await findConnection(db, agencyId)) ?? null,
      canStoreSecrets: seal !== null
    }),

  save: async (agencyId: string, input: ConnectionInput) => {
    if (input.secret === null) {
      const updated = await updateConnection(db, agencyId, input);
      return updated
        ? ok({ connection: updated })
        : fail('invalid', 'Enter the SFTP password for the new connection');
    }
    if (!seal) return fail('conflict', NO_SECRET_KEY);
    return ok({
      connection: await upsertConnection(db, agencyId, input, seal(input.secret, agencyId))
    });
  },

  remove: async (agencyId: string) =>
    (await deleteConnection(db, agencyId))
      ? ok({ removed: true })
      : fail('not_found', 'This agency has no clearinghouse connection')
});

export type ConnectionService = ReturnType<typeof createConnectionService>;
