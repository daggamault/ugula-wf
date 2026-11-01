import type { Db } from '@ugula/db';
import { fail, ok } from '../../shared/result.ts';
import { findPatient, listPatients, type PatientFilters } from './queries.ts';

export const createPatientService = ({ db }: { db: Db }) => ({
  list: async (tenantId: string, filters: PatientFilters) =>
    ok(await listPatients(db, tenantId, filters)),

  find: async (tenantId: string, id: string) => {
    const patient = await findPatient(db, tenantId, id);
    return patient ? ok({ patient }) : fail('not_found', 'Patient not found');
  }
});

export type PatientService = ReturnType<typeof createPatientService>;
