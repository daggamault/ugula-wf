import { CODE_SETS } from '@ugula/billing';
import { PICK_LISTS } from '@ugula/nemsis';
import * as v from 'valibot';
import { searchText } from '../../shared/search.ts';

export const CODE_LIMIT = 50;

const codeList = v.pipe(
  v.string(),
  v.transform((s) => [
    ...new Set(
      s
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
    )
  ]),
  v.maxLength(CODE_LIMIT)
);

export const searchCodesQuery = v.object({
  set: v.picklist(CODE_SETS),
  q: searchText,
  list: v.optional(v.picklist(PICK_LISTS)),
  codes: v.optional(codeList)
});

export type CodesQuery = v.InferOutput<typeof searchCodesQuery>;

export const describeKindQuery = v.object({
  kind: v.pipe(v.string(), v.regex(/^[a-z][A-Za-z0-9]*$/, 'Kinds are camelCase names')),
  codes: codeList
});

export type DescribeKindQuery = v.InferOutput<typeof describeKindQuery>;
