import type { Db } from '@ugula/db';
import type { AgencyAccess } from './access.ts';
import { isUniqueViolation } from './http.ts';
import { fail, ok, type Result } from './result.ts';
import {
  canEditScope,
  type EditTier,
  findHeadVersion,
  findNewestPublished,
  findScoped,
  findSystem,
  findVersionById,
  type Scope,
  type ScopedTable,
  scopeIds,
  setActive
} from './scopes.ts';

type Copyable = { id: string; key: string; scope: Scope };

type Published = NonNullable<Awaited<ReturnType<typeof findNewestPublished>>>;

export const findBaseVersion = async (db: Db, table: ScopedTable, key: string) => {
  const system = (await findSystem(db, table, key))?.id;
  return system ? findNewestPublished(db, table, system) : undefined;
};

export const compareCopy = async (db: Db, table: ScopedTable, item: Copyable) => {
  if (item.scope === 'system') {
    return { mine: null, copiedFrom: null, latest: null, baseChanged: false };
  }
  const mine = await findHeadVersion(db, table, item.id);
  const copied = mine?.base_version_id
    ? await findVersionById(db, table, mine.base_version_id)
    : undefined;
  const latest = await findBaseVersion(db, table, item.key);
  return {
    mine: mine ? { version: mine.version, definition: mine.definition } : null,
    copiedFrom: copied
      ? {
          ownerId: copied.owner_id,
          scope: copied.scope,
          version: copied.version,
          definition: copied.definition
        }
      : null,
    latest: latest ? { version: latest.version, definition: latest.definition } : null,
    baseChanged: !!latest && !!copied && latest.id !== copied.id
  };
};

type CopySpec = {
  noun: 'graph' | 'table';
  tier: EditTier;
  forbidden: () => Result<never>;
  insertCopy: (tx: Db, agencyId: string) => Promise<{ id: string }>;
  insertDraft: (tx: Db, id: string, from: Published) => Promise<unknown>;
};

export const overrideCopy = async (
  tx: Db,
  table: ScopedTable,
  access: AgencyAccess,
  item: Copyable,
  spec: CopySpec
): Promise<Result<{ id: string }>> => {
  if (item.scope !== 'system') {
    return fail('conflict', `This ${spec.noun} cannot be overridden for the agency`);
  }
  if (!canEditScope(access, 'agency', spec.tier)) return spec.forbidden();
  const copy = await findScoped(tx, table, scopeIds(access), item.key);
  const taken = fail('conflict', `This ${spec.noun} is already overridden`);
  if (copy?.is_active) return taken;
  if (copy) {
    await setActive(tx, table, copy.id, true);
    return ok({ id: copy.id });
  }
  const latest = await findNewestPublished(tx, table, item.id);
  if (!latest) {
    return fail('conflict', `This ${spec.noun} has no published version to start from`);
  }
  try {
    const { id } = await spec.insertCopy(tx, access.agencyId);
    await spec.insertDraft(tx, id, latest);
    return ok({ id });
  } catch (err) {
    if (isUniqueViolation(err)) return taken;
    throw err;
  }
};
