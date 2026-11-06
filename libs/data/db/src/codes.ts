import type { CodeDescriptions, CodeRef } from '@ugula/billing';
import type { Db } from './schema.ts';

const keyOf = (r: { set: string; code: string }) => `${r.set}\t${r.code}`;

export const describeCodes = async (db: Db, refs: readonly CodeRef[]) => {
  const unique = [...new Map(refs.map((r) => [keyOf(r), r])).values()];
  const descriptions: CodeDescriptions = {};
  if (!unique.length) return descriptions;
  const rows = await db
    .selectFrom('codes')
    .select(['code_set', 'code', 'description'])
    .where((eb) =>
      eb(
        eb.refTuple('code_set', 'code'),
        'in',
        unique.map((r) => eb.tuple(r.set, r.code))
      )
    )
    .execute();
  for (const r of rows) {
    descriptions[r.code_set] = { ...descriptions[r.code_set], [r.code]: r.description };
  }
  return descriptions;
};
