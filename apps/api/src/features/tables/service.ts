import type { Db } from '@ugula/db';
import { type Json, tableContract, tableSchemas } from '@ugula/graph';
import * as v from 'valibot';
import type { AgencyAccess } from '../../shared/access.ts';
import { isUniqueViolation } from '../../shared/http.ts';
import { fail, ok } from '../../shared/result.ts';
import {
  canEditScope,
  type EditScope,
  listEffective,
  ownerOf,
  RANK,
  type Scope,
  scopeIds
} from '../../shared/scopes.ts';
import {
  findEffectiveTable,
  findNewestPublishedTableVersion,
  findScopedTable,
  findSystemTable,
  findTable,
  findTableDraft,
  findTableVersion,
  findTableVersionById,
  insertTable,
  insertTableDraft,
  listTableVersions,
  nextTableVersion,
  publishTableVersion,
  searchTables,
  setTableActive,
  type TableFilters,
  touchTable,
  updateTableDraft
} from './queries.ts';

const notFound = fail('not_found', 'Table not found');

const forbidden = (scope: EditScope) =>
  fail(
    'forbidden',
    scope === 'organization'
      ? 'Only organization owners can change organization tables'
      : 'You do not have permission to change this table'
  );

export const tableIssues = (kind: keyof typeof tableSchemas, definition: unknown) => {
  const parsed = v.safeParse(tableSchemas[kind], definition);
  return parsed.success ? [] : parsed.issues.map((i) => i.message);
};

export const createTableService = ({ db }: { db: Db }) => {
  const editable = async (tx: Db, access: AgencyAccess, tableId: string) => {
    const table = await findTable(tx, scopeIds(access), tableId);
    if (!table) return notFound;
    if (table.scope === 'system') return fail('forbidden', 'Built-in tables are read-only');
    if (!canEditScope(access, table.scope, 'table')) return forbidden(table.scope);
    return ok({ ...table, scope: table.scope as EditScope });
  };
  const baseOf = async (tx: Db, access: AgencyAccess, table: { key: string; scope: Scope }) => {
    if (RANK[table.scope] === 0) {
      const org = await findScopedTable(
        tx,
        { organizationId: access.organizationId, agencyId: null },
        table.key
      );
      if (org?.is_active) return findNewestPublishedTableVersion(tx, org.id);
    }
    const system = await findSystemTable(tx, table.key);
    return system ? findNewestPublishedTableVersion(tx, system.id) : undefined;
  };
  return {
    search: async (access: AgencyAccess, filters: TableFilters) =>
      ok(await searchTables(db, scopeIds(access), filters)),
    effective: async (access: AgencyAccess) =>
      ok({ tables: await listEffective(db, 'data_tables', scopeIds(access)) }),
    find: async (access: AgencyAccess, id: string) => {
      const table = await findTable(db, scopeIds(access), id);
      if (!table) return notFound;
      const effective = await findEffectiveTable(db, scopeIds(access), table.key);
      return ok({
        table: {
          ...table,
          canEdit: canEditScope(access, table.scope, 'table'),
          canOverride: {
            organization: table.scope === 'system' && access.isOrganizationAdmin,
            agency: table.scope !== 'agency' && canEditScope(access, 'agency', 'table')
          },
          effectiveId: effective?.id ?? table.id,
          effectiveScope: effective?.scope ?? table.scope
        },
        versions: await listTableVersions(db, id)
      });
    },
    version: async (access: AgencyAccess, id: string, version: number) => {
      const found =
        (await findTable(db, scopeIds(access), id)) && (await findTableVersion(db, id, version));
      return found ? ok(found) : fail('not_found', 'Version not found');
    },
    compare: async (access: AgencyAccess, id: string) => {
      const table = await findTable(db, scopeIds(access), id);
      if (!table) return notFound;
      if (table.scope === 'system') {
        return ok({ mine: null, copiedFrom: null, latest: null, baseChanged: false });
      }
      const [head] = await listTableVersions(db, id);
      const mine = head ? await findTableVersion(db, id, head.version) : undefined;
      const copied = mine?.base_version_id
        ? await findTableVersionById(db, mine.base_version_id)
        : undefined;
      const latest = await baseOf(db, access, table);
      return ok({
        mine: mine ? { version: mine.version, definition: mine.definition } : null,
        copiedFrom: copied
          ? {
              tableId: copied.table_id,
              scope: copied.scope,
              version: copied.version,
              definition: copied.definition
            }
          : null,
        latest: latest ? { version: latest.version, definition: latest.definition } : null,
        baseChanged: !!latest && !!copied && latest.id !== copied.id
      });
    },
    override: (access: AgencyAccess, tableId: string, scope: EditScope) =>
      db.transaction().execute(async (tx) => {
        const table = await findTable(tx, scopeIds(access), tableId);
        if (!table) return notFound;
        if (RANK[table.scope] <= RANK[scope]) {
          return fail('conflict', `This table cannot be overridden for the ${scope}`);
        }
        if (!canEditScope(access, scope, 'table')) return forbidden(scope);
        const owner = ownerOf(access, scope);
        const copy = await findScopedTable(tx, owner, table.key);
        if (copy?.is_active) return fail('conflict', 'This table is already overridden');
        if (copy) {
          await setTableActive(tx, copy.id, true);
          return ok({ id: copy.id });
        }
        const latest = await findNewestPublishedTableVersion(tx, table.id);
        if (!latest) return fail('conflict', 'This table has no published version to start from');
        try {
          const { id } = await insertTable(tx, {
            ...owner,
            key: table.key,
            name: table.name,
            kind: table.kind,
            description: table.description
          });
          await insertTableDraft(tx, {
            tableId: id,
            version: 1,
            definition: latest.definition as Json,
            baseVersionId: latest.id,
            userId: access.userId
          });
          return ok({ id });
        } catch (err) {
          if (isUniqueViolation(err)) return fail('conflict', 'This table is already overridden');
          throw err;
        }
      }),
    saveDraft: (access: AgencyAccess, tableId: string, definition: unknown) =>
      db.transaction().execute(async (tx) => {
        const table = await editable(tx, access, tableId);
        if (!table.ok) return table;
        const issues = tableIssues(table.value.kind, definition);
        if (issues.length) return fail('invalid', issues.join('. '));
        const draft = await findTableDraft(tx, tableId);
        if (draft) await updateTableDraft(tx, draft.id, definition as Json);
        const version = draft
          ? draft.version
          : (
              await insertTableDraft(tx, {
                tableId,
                version: await nextTableVersion(tx, tableId),
                definition: definition as Json,
                baseVersionId: (await baseOf(tx, access, table.value))?.id ?? null,
                userId: access.userId
              })
            ).version;
        await touchTable(tx, tableId);
        return ok({ version });
      }),
    publish: (access: AgencyAccess, tableId: string) =>
      db.transaction().execute(async (tx) => {
        const table = await editable(tx, access, tableId);
        if (!table.ok) return table;
        const draft = await findTableDraft(tx, tableId);
        if (!draft) return fail('conflict', 'Nothing to publish');
        const issues = tableIssues(table.value.kind, draft.definition);
        if (issues.length) return fail('invalid', issues.join('. '));
        const system = await findSystemTable(tx, table.value.key);
        const original = system && (await findNewestPublishedTableVersion(tx, system.id));
        if (original && original.contract !== tableContract(draft.definition as Json)) {
          return fail(
            'invalid',
            'An override must keep the inputs and outputs of the built-in table it replaces'
          );
        }
        await publishTableVersion(tx, draft.id);
        await touchTable(tx, tableId);
        return ok({ version: draft.version });
      }),
    remove: async (access: AgencyAccess, tableId: string) => {
      const table = await editable(db, access, tableId);
      if (!table.ok) return table;
      return (await setTableActive(db, tableId, false)) ? ok({ id: tableId }) : notFound;
    }
  };
};

export type TableService = ReturnType<typeof createTableService>;
