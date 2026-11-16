import type { Db } from '@ugula/db';
import { fail, ok } from '../../shared/result.ts';
import { findPatient, type PatientFilters, searchPatients } from './queries.ts';

export const createPatientService = ({ db }: { db: Db }) => ({
  search: async (agencyId: string, filters: PatientFilters) =>
    ok(await searchPatients(db, agencyId, filters)),

  find: async (agencyId: string, id: string) => {
    const patient = await findPatient(db, agencyId, id);
    return patient ? ok({ patient }) : fail('not_found', 'Patient not found');
  }
});

export type PatientService = ReturnType<typeof createPatientService>;
