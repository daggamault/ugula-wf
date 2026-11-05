import type { Db } from '@ugula/db';
import { fail, ok } from '../../shared/result.ts';
import {
  deleteFacility,
  type FacilityFilters,
  findFacility,
  insertFacility,
  searchFacilities,
  updateFacility
} from './queries.ts';
import type { FacilityInput } from './schemas.ts';

const notFound = fail('not_found', 'Facility not found');

const taken = (name: string) => fail('conflict', `A facility named ${name} already exists`);

const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';

export const createFacilityService = ({ db }: { db: Db }) => ({
  search: async (agencyId: string, filters: FacilityFilters) =>
    ok(await searchFacilities(db, agencyId, filters)),

  find: async (agencyId: string, id: string) => {
    const facility = await findFacility(db, agencyId, id);
    return facility ? ok({ facility }) : notFound;
  },

  create: async (agencyId: string, input: FacilityInput) => {
    const created = await insertFacility(db, agencyId, input);
    return created ? ok({ id: created.id }) : taken(input.name);
  },

  update: async (agencyId: string, id: string, input: FacilityInput) => {
    try {
      const updated = await updateFacility(db, agencyId, id, input);
      return updated ? ok({ id: updated.id }) : notFound;
    } catch (err) {
      if (isUniqueViolation(err)) return taken(input.name);
      throw err;
    }
  },

  remove: async (agencyId: string, id: string) =>
    (await deleteFacility(db, agencyId, id)) ? ok({ status: 'deleted' }) : notFound
});

export type FacilityService = ReturnType<typeof createFacilityService>;
