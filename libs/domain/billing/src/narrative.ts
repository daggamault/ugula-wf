import { isRecord } from '@ugula/graph';
import type { Completer, CompletionRequest } from './completions.ts';

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

const ROUTES = ['IV', 'IO', 'IM', 'IN', 'PO', 'SL', 'NEB', 'SQ', 'other'] as const;

export type Route = (typeof ROUTES)[number];

export type Medication = { medication: string; route: Route; doses: number };

export type NarrativeFindings = {
  medications: Medication[];
  procedures: Als2Procedure[];
  ivDoses: number;
  notes: string[];
};

const MAX_NARRATIVE_CHARS = 12_000;

export const TRUNCATED_NOTE = `The narrative is longer than ${MAX_NARRATIVE_CHARS.toLocaleString('en-US')} characters; only the start was read`;

export const UNREAD_FINDINGS: NarrativeFindings = {
  medications: [],
  procedures: [],
  ivDoses: 0,
  notes: ['The language model was unavailable, so the narrative was not read']
};

const MAX_DOSES = 20;

const MAX_EVIDENCE_CHARS = 200;

const MIN_EVIDENCE_CHARS = 2;

const EVIDENCE = { type: 'string', maxLength: MAX_EVIDENCE_CHARS };

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
        required: ['medication', 'route', 'doses', 'evidence'],
        properties: {
          medication: { type: 'string', maxLength: 60 },
          route: { enum: ROUTES },
          doses: { type: 'integer', minimum: 1, maximum: MAX_DOSES },
          evidence: EVIDENCE
        }
      }
    },
    procedures: {
      type: 'array',
      maxItems: ALS2_PROCEDURES.length,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['procedure', 'evidence'],
        properties: { procedure: { enum: ALS2_PROCEDURES }, evidence: EVIDENCE }
      }
    }
  }
};

const SYSTEM = `You extract billing facts from an EMS patient care narrative.
1. medications: each drug the crew gave, its route, and how many separate doses ("x3" or "q4 x3" is 3 doses). Vascular access (IV or IO placement), oxygen and IV solutions (normal saline, lactated Ringer's, D5W, D10, D50 and other dextrose) are not medications.
2. procedures: only those of these the narrative says the crew performed: ${ALS2_PROCEDURES.join(', ')}. Most narratives describe none of them, so the list is usually empty. A shock the crew delivered with a manual monitor/defibrillator is defibrillation; an AED shock is not. An IO needle or IO access is an intraosseous line. Supraglottic airways (King, i-gel, LMA) are not surgical airways.
For every item, evidence is the exact words copied from the narrative that show the crew did it. Leave out anything the narrative does not say, and anything refused, considered, or done before this crew arrived.`;

const NO_FINDINGS: NarrativeFindings = { medications: [], procedures: [], ivDoses: 0, notes: [] };

const narrativeRequest = (narrative: string): CompletionRequest => ({
  system: SYSTEM,
  user: narrative.slice(0, MAX_NARRATIVE_CHARS),
  schema: NARRATIVE_SCHEMA,
  maxTokens: 1_200
});

const PROCEDURE_TERMS: Readonly<Record<Als2Procedure, RegExp>> = {
  'endotracheal intubation': /intubat|endotracheal|\bett\b|\bet tube/,
  'cardiac pacing': /\bpac(?:ing|ed|er)\b|\btcp\b/,
  defibrillation: /^(?!.*\baed\b).*(?:defib|shock|joule|\b\d+\s*j\b)/,
  cardioversion: /cardiover|synchroni[sz]ed/,
  'central venous line': /central (?:venous|line)|\bcvc\b|subclavian|jugular|femoral (?:line|vein)/,
  'chest decompression': /decompress|thoracostomy/,
  'surgical airway': /cric|surgical airway/,
  'intraosseous line': /\bio\b|intraosseous|ez-?io/
};

const IV_SOLUTION = /saline|ringer|dextrose|glucose|sodium chloride|\bd\d{1,2}w?\b|\bns\b|\blr\b/i;

const normalized = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

const quoteOf = (x: unknown, narrative: string) => {
  const quote = typeof x === 'string' ? normalized(x) : '';
  return quote.length >= MIN_EVIDENCE_CHARS && narrative.includes(quote) ? quote : null;
};

const isRoute = (x: unknown): x is Route => ROUTES.includes(x as Route);

const isProcedure = (x: unknown): x is Als2Procedure =>
  ALS2_PROCEDURES.includes(x as Als2Procedure);

const medicationOf =
  (narrative: string) =>
  (x: unknown): Medication[] => {
    if (!isRecord(x) || typeof x.medication !== 'string' || !isRoute(x.route)) return [];
    const medication = x.medication.trim();
    const doses = Number.isInteger(x.doses)
      ? Math.min(Math.max(x.doses as number, 1), MAX_DOSES)
      : 1;
    return medication && !IV_SOLUTION.test(medication) && quoteOf(x.evidence, narrative)
      ? [{ medication, route: x.route, doses }]
      : [];
  };

const procedureOf =
  (narrative: string) =>
  (x: unknown): Als2Procedure[] => {
    if (!isRecord(x) || !isProcedure(x.procedure)) return [];
    const quote = quoteOf(x.evidence, narrative);
    return quote && PROCEDURE_TERMS[x.procedure].test(quote) ? [x.procedure] : [];
  };

export const readFindings = (x: unknown, narrative: string): NarrativeFindings => {
  const r = isRecord(x) ? x : {};
  const text = normalized(narrative);
  const medications = (Array.isArray(r.medications) ? r.medications : []).flatMap(
    medicationOf(text)
  );
  const procedures = [
    ...new Set((Array.isArray(r.procedures) ? r.procedures : []).flatMap(procedureOf(text)))
  ];
  return {
    medications,
    procedures,
    ivDoses: medications
      .filter((m) => m.route === 'IV' || m.route === 'IO')
      .reduce((n, m) => n + m.doses, 0),
    notes: []
  };
};

export const readNarrative = async (
  completer: Completer,
  narrative: string,
  signal?: AbortSignal
): Promise<NarrativeFindings> => {
  if (!narrative.trim()) return NO_FINDINGS;
  const findings = readFindings(
    await completer.complete(narrativeRequest(narrative), signal),
    narrative
  );
  return narrative.length > MAX_NARRATIVE_CHARS
    ? { ...findings, notes: [TRUNCATED_NOTE] }
    : findings;
};
