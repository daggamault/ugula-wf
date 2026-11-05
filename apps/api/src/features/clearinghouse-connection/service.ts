import type { Db } from '@ugula/db';
import { fail, ok } from '../../shared/result.ts';
import { endpointIssue } from './endpoints.ts';
import {
  deleteConnection,
  findConnection,
  updateKeepingSecret,
  upsertConnection
} from './queries.ts';
import type { ConnectionInput } from './schemas.ts';

type Seal = (secret: string, agencyId: string) => string;

type ConnectionServiceDeps = { db: Db; seal: Seal | null; allowLocal: boolean };

export const NO_SECRET_KEY =
  'This server cannot store clearinghouse passwords yet; ask your system administrator to set it up';

export const SECRET_FOR_ENDPOINT =
  'Enter the SFTP password again: changing the host, port, host key, username or real-time URL needs it';

export const createConnectionService = ({ db, seal, allowLocal }: ConnectionServiceDeps) => ({
  find: async (agencyId: string) =>
    ok({
      connection: (await findConnection(db, agencyId)) ?? null,
      canStoreSecrets: seal !== null
    }),

  save: async (agencyId: string, input: ConnectionInput) => {
    const issue = endpointIssue(input, allowLocal);
    if (issue) return fail('invalid', issue);
    if (input.secret === null) {
      const updated = await updateKeepingSecret(db, agencyId, input);
      if (updated) return ok({ connection: updated });
      return fail(
        'invalid',
        (await findConnection(db, agencyId))
          ? SECRET_FOR_ENDPOINT
          : 'Enter the SFTP password for the new connection'
      );
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
