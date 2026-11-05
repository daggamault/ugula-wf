import { billingTypes } from '@ugula/billing';
import type { ExitDoc, GraphDef, Json, PinSpec, ValueType, VariableDef } from '@ugula/graph';
import { PCR_TYPE } from '@ugula/nemsis';
import { createTables, graph } from '../builder.ts';
import type { SeedGraph } from '../graphs.ts';

export const T = { ...billingTypes, pcr: PCR_TYPE };

export const ADDRESS_PINS = ['addressLine', 'city', 'state', 'postalCode'];

export const CHARGE_LINES: ValueType = { list: { object: { code: 'string', units: 'number' } } };

export const FEES: ValueType = { object: {} };

export type Builder = ReturnType<typeof graph>;

export const shared = createTables();

export const d = (
  name: string,
  type: ValueType,
  label: string,
  description: string,
  optional = false
): PinSpec => ({ name, type, label, description, ...(optional ? { optional: true } : {}) });

export const exit = (label: string, description: string): ExitDoc => ({ label, description });

export const rule = (inputs: PinSpec[], outputs: PinSpec[]) =>
  graph({ execIn: [], execOut: [], inputs, outputs });

export const stage = (
  inputs: PinSpec[],
  outputs: PinSpec[],
  exits: Record<string, ExitDoc>,
  variables: VariableDef[] = []
) => graph({ execIn: ['exec'], execOut: Object.keys(exits), inputs, outputs, exits }, variables);

export const flow = (inputs: PinSpec[], outputs: PinSpec[], variables: VariableDef[] = []) =>
  graph({ execIn: ['exec'], execOut: [], inputs, outputs }, variables);

const seed =
  (kind: SeedGraph['kind'], role: SeedGraph['role']) =>
  (key: string, name: string, description: string, definition: GraphDef): SeedGraph => ({
    key,
    name,
    kind,
    role,
    description,
    version: 1,
    definition
  });

export const asRule = seed('node', 'rule');

export const asStage = seed('node', 'stage');

export const asWorkflow = seed('workflow', 'workflow');

export type Field = { name: string; type: ValueType; label: string };

export const field = (name: string, type: ValueType, label: string): Field => ({
  name,
  type,
  label
});

type Rule = { label: string; when?: Record<string, Json>; set?: Record<string, Json> };

export const table = (
  inputs: Field[],
  outputs: Field[],
  rules: Rule[],
  otherwise: Record<string, Json> = {}
) => ({
  inputs,
  outputs,
  rules: rules.map((r) => ({ label: r.label, when: r.when ?? {}, set: r.set ?? {} })),
  otherwise
});

export const is = (value: Json) => ({ op: 'is', value });
export const oneOf = (...value: string[]) => ({ op: 'oneOf', value });
export const notOneOf = (...value: string[]) => ({ op: 'notOneOf', value });
export const atLeast = (value: number) => ({ op: 'gte', value });
export const above = (value: number) => ({ op: 'gt', value });
export const below = (value: number) => ({ op: 'lt', value });
export const atMost = (value: number) => ({ op: 'lte', value });
export const startsWith = (...value: string[]) => ({ op: 'startsWith', value });

export const expr = (label: string, expression: string) => ({ label, config: { expression } });

export const subject = (...parts: string[]) =>
  expr('Task Subject', `join(filter([${parts.join(', ')}], x => x != null && x != ''), ' · ')`);

export const placeOf = (place: string) =>
  `join(filter([
    ${place}.addressLine,
    ${place}.city != null && !every(split(${place}.city, ''), d => contains('0123456789', d)) ? ${place}.city : null,
    ${place}.postalCode
  ], x => x != null && x != ''), ', ')`;

export const nameOf = (person: string) =>
  `join(filter([${person}.firstName, ${person}.lastName], x => x != null), ' ')`;

export const P = {
  pcr: (optional = false) =>
    d('pcr', PCR_TYPE, 'PCR', 'The patient care report the claim is billed from.', optional),
  facts: (optional = false) =>
    d(
      'facts',
      T.facts,
      'Encounter Facts',
      'The normalized trip, locations, patient, clinical, documentation and reported coverages of the report.',
      optional
    ),
  claimId: () => d('claimId', 'string', 'Claim', 'The claim being worked.'),
  report: (optional = true) =>
    d(
      'report',
      T.blob,
      'Report',
      'The stored patient care report (JSON) the claim came from.',
      optional
    ),
  tripType: (optional = false) =>
    d(
      'tripType',
      'string',
      'Trip Type',
      'emergency, scheduled, treatNoTransport, refusal or noClaim.',
      optional
    ),
  reason: () =>
    d(
      'reason',
      'string',
      'Classified By',
      'The Trip Type rule that matched, or nothing when none did.',
      true
    ),
  service: (optional = false) =>
    d(
      'service',
      T.service,
      'Service',
      'The level of service, emergency status and loaded miles, with the reasons.',
      optional
    ),
  findings: (optional = false) =>
    d(
      'findings',
      T.findings,
      'Narrative Findings',
      'The medications and procedures the narrative documents, as read by the local model.',
      optional
    ),
  patient: (optional = false) =>
    d('patient', T.patient, 'Patient', 'The billing patient the report was matched to.', optional),
  coverages: (description = 'The payers, in billing order.') =>
    d('coverages', T.coverages, 'Coverages', description),
  subject: () =>
    d('subject', 'string', 'Task Subject', 'How tasks name the claim in task lists.', true),
  context: () =>
    d('context', 'any', 'Task Details', 'What tasks show a biller about the claim.', true),
  coverageId: () =>
    d(
      'coverageId',
      'string',
      'Payer',
      'The coverage (payer on the claim) this step is about.',
      true
    ),
  reasons: (what: string) =>
    d(
      'reasons',
      { list: 'string' },
      'Reasons',
      `Every rule that held, so a biller sees why ${what}.`
    ),
  issues: (description = 'Issues found, each with its code, severity, message and field to fix.') =>
    d('issues', T.issues, 'Issues', description)
};
