import type { Db } from '@ugula/db';
import type { AgencyAccess } from './access.ts';
import { isUniqueViolation } from './http.ts';
import { fail, ok, type Result } from './result.ts';
import {
  canEditScope,
  type EditScope,
  type EditTier,
  findHeadVersion,
  findNewestPublished,
  findScoped,
  findSystem,
  findVersionById,
  type Owner,
  ownerOf,
  RANK,
  type Scope,
  type ScopedTable,
  setActive
} from './scopes.ts';

type Copyable = { id: string; key: string; scope: Scope };

type Published = NonNullable<Awaited<ReturnType<typeof findNewestPublished>>>;

export const findBaseVersion = async (
  db: Db,
  table: ScopedTable,
  access: AgencyAccess,
  item: Pick<Copyable, 'key' | 'scope'>
) => {
  const org =
    RANK[item.scope] === 0
      ? await findScoped(
          db,
          table,
          { organizationId: access.organizationId, agencyId: null },
          item.key
        )
      : undefined;
  const below = org?.is_active ? org.id : (await findSystem(db, table, item.key))?.id;
  return below ? findNewestPublished(db, table, below) : undefined;
};

export const compareCopy = async (
  db: Db,
  table: ScopedTable,
  access: AgencyAccess,
  item: Copyable
) => {
  if (item.scope === 'system') {
    return { mine: null, copiedFrom: null, latest: null, baseChanged: false };
  }
  const mine = await findHeadVersion(db, table, item.id);
  const copied = mine?.base_version_id
    ? await findVersionById(db, table, mine.base_version_id)
    : undefined;
  const latest = await findBaseVersion(db, table, access, item);
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
  forbidden: (scope: EditScope) => Result<never>;
  insertCopy: (tx: Db, owner: Owner) => Promise<{ id: string }>;
  insertDraft: (tx: Db, id: string, from: Published) => Promise<unknown>;
};

export const overrideCopy = async (
  tx: Db,
  table: ScopedTable,
  access: AgencyAccess,
  item: Copyable,
  scope: EditScope,
  spec: CopySpec
): Promise<Result<{ id: string }>> => {
  if (RANK[item.scope] <= RANK[scope]) {
    return fail('conflict', `This ${spec.noun} cannot be overridden for the ${scope}`);
  }
  if (!canEditScope(access, scope, spec.tier)) return spec.forbidden(scope);
  const owner = ownerOf(access, scope);
  const copy = await findScoped(tx, table, owner, item.key);
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
    const { id } = await spec.insertCopy(tx, owner);
    await spec.insertDraft(tx, id, latest);
    return ok({ id });
  } catch (err) {
    if (isUniqueViolation(err)) return taken;
    throw err;
  }
};
