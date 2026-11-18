import {
  CLASSIFICATION_LABELS,
  type CodeSet,
  normalizeCode,
  ORIGIN_DESTINATION_CODES
} from '@ugula/billing';
import type { Db } from '@ugula/db';
import { codeKindElements } from '@ugula/nemsis';
import { ok } from '../../shared/result.ts';
import { describeNemsisCodes, searchCodes } from './queries.ts';
import type { CodesQuery, DescribeKindQuery } from './schemas.ts';

type Meaning = { code: string; description: string };

const CODE_SET_KINDS: Readonly<Record<string, CodeSet>> = {
  icd10: 'icd10cm',
  locationType: 'icd10cm',
  hcpcs: 'hcpcs',
  modifier: 'modifier',
  rxnorm: 'rxnorm',
  snomed: 'snomed'
};

const LABELED_KINDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  tripClassification: CLASSIFICATION_LABELS,
  placeCode: ORIGIN_DESTINATION_CODES
};

const fromLabels = (
  labels: Readonly<Record<string, string>>,
  codes: readonly string[]
): Meaning[] =>
  codes.flatMap((code) => {
    const description = Object.hasOwn(labels, code) ? labels[code] : undefined;
    return description ? [{ code, description }] : [];
  });

const fromCodeSet = async (db: Db, set: CodeSet, codes: readonly string[]): Promise<Meaning[]> => {
  const rows = await searchCodes(db, { set, q: '', codes: [...codes] });
  const byCode = new Map(rows.map((r) => [r.code, r.description]));
  return codes.flatMap((code) => {
    const description = byCode.get(normalizeCode(set, code));
    return description ? [{ code, description }] : [];
  });
};

export const createCodeService = ({ db }: { db: Db }) => ({
  find: async (query: CodesQuery) => ok({ codes: await searchCodes(db, query) }),
  describeKind: async ({ kind, codes }: DescribeKindQuery) => {
    const set = CODE_SET_KINDS[kind];
    const labels = LABELED_KINDS[kind];
    const element = codeKindElements[kind];
    const meanings = set
      ? await fromCodeSet(db, set, codes)
      : labels
        ? fromLabels(labels, codes)
        : element
          ? await describeNemsisCodes(db, element, codes)
          : [];
    return ok({ codes: meanings });
  }
});

export type CodeService = ReturnType<typeof createCodeService>;
