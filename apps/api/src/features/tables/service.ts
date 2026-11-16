import type { Db } from '@ugula/db';
import { type Json, tableContract, tableSchemas } from '@ugula/graph';
import * as v from 'valibot';
import type { AgencyAccess } from '../../shared/access.ts';
import { compareCopy, findBaseVersion, overrideCopy } from '../../shared/copies.ts';
import { fail, ok } from '../../shared/result.ts';
import {
  canEditScope,
  findDraftOf,
  findEffectiveIn,
  findVersionOf,
  listEffective,
  lockOwner,
  nextVersionOf,
  scopeIds,
  setActive,
  touch
} from '../../shared/scopes.ts';
import {
  findTable,
  insertTable,
  insertTableDraft,
  listTableVersions,
  publishTableVersion,
  searchTables,
  type TableFilters,
  updateTableDraft
} from './queries.ts';

const notFound = fail('not_found', 'Table not found');

const forbidden = () => fail('forbidden', 'You do not have permission to change this table');

export const tableIssues = (kind: keyof typeof tableSchemas, definition: unknown) => {
  const parsed = v.safeParse(tableSchemas[kind], definition);
  return parsed.success ? [] : parsed.issues.map((i) => i.message);
};

export const createTableService = ({ db }: { db: Db }) => {
  const editable = async (tx: Db, access: AgencyAccess, tableId: string) => {
    const table = await findTable(tx, scopeIds(access), tableId);
    if (!table) return notFound;
    if (table.scope === 'system') return fail('forbidden', 'Built-in tables are read-only');
    if (!canEditScope(access, table.scope, 'table')) return forbidden();
    await lockOwner(tx, 'data_tables', tableId);
    return ok(table);
  };
  return {
    search: async (access: AgencyAccess, filters: TableFilters) =>
      ok(await searchTables(db, scopeIds(access), filters)),
    effective: async (access: AgencyAccess) =>
      ok({ tables: await listEffective(db, 'data_tables', scopeIds(access)) }),
    find: async (access: AgencyAccess, id: string) => {
      const table = await findTable(db, scopeIds(access), id);
      if (!table) return notFound;
      const effective = await findEffectiveIn(db, 'data_tables', scopeIds(access), table.key);
      return ok({
        table: {
          ...table,
          canEdit: canEditScope(access, table.scope, 'table'),
          canOverride: table.scope === 'system' && canEditScope(access, 'agency', 'table'),
          effectiveId: effective?.id ?? table.id,
          effectiveScope: effective?.scope ?? table.scope
        },
        versions: await listTableVersions(db, id)
      });
    },
    version: async (access: AgencyAccess, id: string, version: number) => {
      const found =
        (await findTable(db, scopeIds(access), id)) &&
        (await findVersionOf(db, 'data_tables', id, version));
      return found ? ok(found) : fail('not_found', 'Version not found');
    },
    compare: async (access: AgencyAccess, id: string) => {
      const table = await findTable(db, scopeIds(access), id);
      if (!table) return notFound;
      const { copiedFrom, ...rest } = await compareCopy(db, 'data_tables', table);
      return ok({
        ...rest,
        copiedFrom: copiedFrom && {
          tableId: copiedFrom.ownerId,
          scope: copiedFrom.scope,
          version: copiedFrom.version,
          definition: copiedFrom.definition
        }
      });
    },
    override: (access: AgencyAccess, tableId: string) =>
      db.transaction().execute(async (tx) => {
        const table = await findTable(tx, scopeIds(access), tableId);
        if (!table) return notFound;
        return overrideCopy(tx, 'data_tables', access, table, {
          noun: 'table',
          tier: 'table',
          forbidden,
          insertCopy: (t, agencyId) =>
            insertTable(t, {
              agencyId,
              key: table.key,
              name: table.name,
              kind: table.kind,
              description: table.description
            }),
          insertDraft: (t, id, latest) =>
            insertTableDraft(t, {
              tableId: id,
              version: 1,
              definition: latest.definition as Json,
              baseVersionId: latest.id,
              userId: access.userId
            })
        });
      }),
    saveDraft: (access: AgencyAccess, tableId: string, definition: unknown) =>
      db.transaction().execute(async (tx) => {
        const table = await editable(tx, access, tableId);
        if (!table.ok) return table;
        const issues = tableIssues(table.value.kind, definition);
        if (issues.length) return fail('invalid', issues.join('. '));
        const draft = await findDraftOf(tx, 'data_tables', tableId);
        if (draft) await updateTableDraft(tx, draft.id, definition as Json);
        const version = draft
          ? draft.version
          : (
              await insertTableDraft(tx, {
                tableId,
                version: await nextVersionOf(tx, 'data_tables', tableId),
                definition: definition as Json,
                baseVersionId:
                  (await findBaseVersion(tx, 'data_tables', table.value.key))?.id ?? null,
                userId: access.userId
              })
            ).version;
        await touch(tx, 'data_tables', tableId);
        return ok({ version });
      }),
    publish: (access: AgencyAccess, tableId: string) =>
      db.transaction().execute(async (tx) => {
        const table = await editable(tx, access, tableId);
        if (!table.ok) return table;
        const draft = await findDraftOf(tx, 'data_tables', tableId);
        if (!draft) return fail('conflict', 'Nothing to publish');
        const issues = tableIssues(table.value.kind, draft.definition);
        if (issues.length) return fail('invalid', issues.join('. '));
        const original = await findBaseVersion(tx, 'data_tables', table.value.key);
        if (original && original.contract !== tableContract(draft.definition as Json)) {
          return fail(
            'invalid',
            'An override must keep the inputs and outputs of the built-in table it replaces'
          );
        }
        await publishTableVersion(tx, draft.id);
        await touch(tx, 'data_tables', tableId);
        return ok({ version: draft.version });
      }),
    remove: (access: AgencyAccess, tableId: string) =>
      db.transaction().execute(async (tx) => {
        const table = await editable(tx, access, tableId);
        if (!table.ok) return table;
        return (await setActive(tx, 'data_tables', tableId, false))
          ? ok({ id: tableId })
          : notFound;
      })
  };
};

export type TableService = ReturnType<typeof createTableService>;
