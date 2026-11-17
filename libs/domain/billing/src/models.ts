import type { Model } from '@ugula/graph';
import {
  CLAIM,
  CLINICAL_FACTS,
  DOCUMENTATION,
  ENCOUNTER_FACTS,
  FINDINGS,
  LINE,
  LOCATION_FACTS,
  SERVICE,
  TRIP_FACTS
} from './claim-models.ts';
import { COVERAGE, DEMOGRAPHICS, LOCATION, PATIENT } from './party-models.ts';

export const billingModels: Model[] = [
  DEMOGRAPHICS,
  PATIENT,
  LOCATION,
  COVERAGE,
  SERVICE,
  FINDINGS,
  LINE,
  DOCUMENTATION,
  TRIP_FACTS,
  LOCATION_FACTS,
  CLINICAL_FACTS,
  ENCOUNTER_FACTS,
  CLAIM
].map(({ type: _, ...m }) => m);
