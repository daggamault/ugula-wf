import { emailString } from '@ugula/config';
import * as v from 'valibot';
import { uuid } from '../../shared/http.ts';
import { pageEntries } from '../../shared/paging.ts';
import { searchText } from '../../shared/search.ts';

const USER_SORTS = ['name', 'email', 'role'] as const;

export type UserSort = (typeof USER_SORTS)[number];

export const listUsersQuery = v.object({
  q: searchText,
  ...pageEntries(USER_SORTS, 'name', 'asc')
});

export const updateUserSchema = v.object({
  roleId: uuid,
  version: v.pipe(v.number(), v.integer(), v.minValue(1))
});

const personName = v.pipe(v.string(), v.trim(), v.nonEmpty('Enter a name'), v.maxLength(80));

export const inviteSchema = v.object({
  email: emailString,
  firstName: personName,
  lastName: personName,
  roleId: uuid
});

export type InviteInput = v.InferOutput<typeof inviteSchema>;
