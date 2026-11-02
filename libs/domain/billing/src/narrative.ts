import type { Completer, CompletionRequest } from './completions.ts';
import { isRecord } from './values.ts';

export const ALS2_PROCEDURES = [
  'endotracheal intubation',
  'cardiac pacing',
  'defibrillation',
  'cardioversion',
  'central venous line',
  'chest decompression',
  'surgical airway',
  'intraosseous line'
] as const;

export type Als2Procedure = (typeof ALS2_PROCEDURES)[number];

export const ROUTES = ['IV', 'IO', 'IM', 'IN', 'PO', 'SL', 'NEB', 'SQ', 'other'] as const;

export type Route = (typeof ROUTES)[number];

export type Medication = { medication: string; route: Route; doses: number };

export type NarrativeFindings = {
  medications: Medication[];
  procedures: Als2Procedure[];
  ivDoses: number;
};

const MAX_NARRATIVE_CHARS = 12_000;

const MAX_DOSES = 20;

const NARRATIVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['medications', 'procedures'],
  properties: {
    medications: {
      type: 'array',
      maxItems: 40,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['medication', 'route', 'doses'],
        properties: {
          medication: { type: 'string', maxLength: 60 },
          route: { enum: ROUTES },
          doses: { type: 'integer', minimum: 1, maximum: MAX_DOSES }
        }
      }
    },
    procedures: {
      type: 'array',
      maxItems: ALS2_PROCEDURES.length,
      items: { enum: ALS2_PROCEDURES }
    }
  }
};

const SYSTEM = `You extract billing facts from an EMS patient care narrative.
1. medications: each drug the crew gave, its route, and how many separate doses ("x3" or "q4 x3" is 3 doses). Vascular access (IV or IO placement), oxygen and fluids are not medications.
2. procedures: each of these the crew performed: ${ALS2_PROCEDURES.join(', ')}. Any shock or joules delivered is defibrillation. An IO needle or IO access is an intraosseous line. Supraglottic airways (King, i-gel, LMA) are not surgical airways.
Only include what this crew did, not what was refused, considered, or done before their arrival.`;

export const NO_FINDINGS: NarrativeFindings = { medications: [], procedures: [], ivDoses: 0 };

export const narrativeRequest = (narrative: string): CompletionRequest => ({
  system: SYSTEM,
  user: narrative.slice(0, MAX_NARRATIVE_CHARS),
  schema: NARRATIVE_SCHEMA,
  maxTokens: 800
});

const isRoute = (x: unknown): x is Route => ROUTES.includes(x as Route);

const isProcedure = (x: unknown): x is Als2Procedure =>
  ALS2_PROCEDURES.includes(x as Als2Procedure);

const medicationOf = (x: unknown): Medication[] => {
  if (!isRecord(x) || typeof x.medication !== 'string' || !isRoute(x.route)) return [];
  const medication = x.medication.trim();
  const doses = Number.isInteger(x.doses) ? Math.min(Math.max(x.doses as number, 1), MAX_DOSES) : 1;
  return medication ? [{ medication, route: x.route, doses }] : [];
};

export const readFindings = (x: unknown): NarrativeFindings => {
  const r = isRecord(x) ? x : {};
  const medications = (Array.isArray(r.medications) ? r.medications : []).flatMap(medicationOf);
  const procedures = [
    ...new Set((Array.isArray(r.procedures) ? r.procedures : []).filter(isProcedure))
  ];
  return {
    medications,
    procedures,
    ivDoses: medications
      .filter((m) => m.route === 'IV' || m.route === 'IO')
      .reduce((n, m) => n + m.doses, 0)
  };
};

export const readNarrative = async (completer: Completer, narrative: string) =>
  narrative.trim()
    ? readFindings(await completer.complete(narrativeRequest(narrative)))
    : NO_FINDINGS;
