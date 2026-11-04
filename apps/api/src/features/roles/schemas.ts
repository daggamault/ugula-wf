import { PERMISSIONS } from '@ugula/access';
import * as v from 'valibot';
import { pageEntries } from '../../shared/paging.ts';
import { searchText } from '../../shared/search.ts';

const ROLE_SORTS = ['name', 'users', 'updated'] as const;

export type RoleSort = (typeof ROLE_SORTS)[number];

export const listRolesQuery = v.object({
  q: searchText,
  ...pageEntries(ROLE_SORTS, 'name', 'asc')
});

const roleFields = {
  name: v.pipe(v.string(), v.trim(), v.nonEmpty('Enter a name'), v.maxLength(80)),
  permissions: v.pipe(
    v.array(v.picklist(PERMISSIONS)),
    v.transform((list) => [...new Set(list)].sort())
  )
};

export const createRoleSchema = v.object(roleFields);

export const updateRoleSchema = v.object({
  ...roleFields,
  version: v.pipe(v.number(), v.integer(), v.minValue(1))
});

export type RoleInput = v.InferOutput<typeof createRoleSchema>;
