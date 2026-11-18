import fs from 'node:fs';
import {
  type GraphDef,
  inlineTables,
  isRecord,
  type Json,
  type NodeDef,
  runRule
} from '@ugula/graph';
import { parseDataset, toEncounter } from '@ugula/nemsis';
import type { SeedTable } from './builder.ts';
import type { SeedGraph } from './graphs.ts';

type Expected = { classification: string; lines: string[] };

const SAMPLES = '.xmls';

const NOW = new Date('2026-11-17T00:00:00Z');

const EXPECTED: Record<string, Expected[]> = {
  'als1-iv-solutions.xml': [
    { classification: 'emergency', lines: ['A0427-EH x1', 'A0425-EH x6.4'] }
  ],
  'als2-cardiac-arrest.xml': [
    { classification: 'emergency', lines: ['A0433-RH x1', 'A0425-RH x5.4'] }
  ],
  'als2-iv-medications.xml': [
    { classification: 'emergency', lines: ['A0433-PH x1', 'A0425-PH x6.9'] }
  ],
  'auto-accident-msp.xml': [
    { classification: 'emergency', lines: ['A0427-SH x1', 'A0425-SH x4.6'] }
  ],
  'batch-three-reports.xml': [
    { classification: 'emergency', lines: ['A0429-SH x1', 'A0425-SH x8.3'] },
    { classification: 'notBillable', lines: ['A0429 x1'] },
    { classification: 'treatNoTransport', lines: ['A0998 x1'] }
  ],
  'bls-emergency-commercial.xml': [
    { classification: 'emergency', lines: ['A0429-SH x1', 'A0425-SH x8.3'] }
  ],
  'bls-emergency-commercial-corrected.xml': [
    { classification: 'emergency', lines: ['A0429-SH x1', 'A0425-SH x10.1'] }
  ],
  'cancelled-prior-to-arrival.xml': [{ classification: 'notBillable', lines: ['A0429 x1'] }],
  'contract-facility.xml': [
    { classification: 'scheduled', lines: ['A0429-EH x1', 'A0425-EH x4.6'] }
  ],
  'critical-care-scene.xml': [
    { classification: 'emergency', lines: ['A0427-RH x1', 'A0425-RH x6.3'] }
  ],
  'dead-at-scene-ql.xml': [{ classification: 'pronouncedDead', lines: ['A0429-RH-QL x1'] }],
  'dependent-secondary-coverage.xml': [
    { classification: 'emergency', lines: ['A0429-SH x1', 'A0425-SH x5.8'] }
  ],
  'emergent-interfacility.xml': [
    { classification: 'scheduled', lines: ['A0427-HH x1', 'A0425-HH x13.6'] }
  ],
  'farther-facility-a0888.xml': [
    { classification: 'emergency', lines: ['A0427-RH x1', 'A0425-RH x2', 'A0888-RH x2.6'] }
  ],
  'long-distance-stale-pcs.xml': [
    { classification: 'scheduled', lines: ['A0428-HH x1', 'A0425-HH x124'] }
  ],
  'medicaid-by-payment-method-unsigned.xml': [
    { classification: 'emergency', lines: ['A0429-RH x1', 'A0425-RH x4.5'] }
  ],
  'missing-disposition.xml': [{ classification: 'notBillable', lines: ['A0429-SH x1'] }],
  'missing-patient-details.xml': [
    { classification: 'emergency', lines: ['A0429-RH x1', 'A0425-RH x5.3'] }
  ],
  'multiple-patients-gm.xml': [
    { classification: 'emergency', lines: ['A0427-RH-GM x1', 'A0425-RH-GM x4.6'] }
  ],
  'nemsis-34-emergency.xml': [
    { classification: 'emergency', lines: ['A0427-RH x1', 'A0425-RH x6.9'] }
  ],
  'new-patient-medicare.xml': [
    { classification: 'emergency', lines: ['A0427-RH x1', 'A0425-RH x4.6'] }
  ],
  'refusal-unsigned.xml': [{ classification: 'refusal', lines: ['A0429 x1'] }],
  'rescue-no-patient-care.xml': [{ classification: 'notBillable', lines: ['A0429 x1'] }],
  'scheduled-dialysis-pcs.xml': [
    { classification: 'scheduled', lines: ['A0428-RJ x1', 'A0425-RJ x5.9'] }
  ],
  'scheduled-missing-pcs.xml': [
    { classification: 'scheduled', lines: ['A0428-HN x1', 'A0425-HN x8.5'] }
  ],
  'sct-interfacility.xml': [
    { classification: 'scheduled', lines: ['A0434-HH x1', 'A0425-HH x42.2'] }
  ],
  'short-trip-self-pay.xml': [
    { classification: 'emergency', lines: ['A0429-RH x1', 'A0425-RH x0.4'] }
  ],
  'treat-no-transport-medicare.xml': [{ classification: 'treatNoTransport', lines: ['A0998 x1'] }],
  'work-injury-msp.xml': [{ classification: 'emergency', lines: ['A0427-RH x1', 'A0425-RH x4.6'] }]
};

type Line = { code: string; modifiers: string[]; units: number };

const lineText = (l: Line) => `${[l.code, ...l.modifiers].join('-')} x${l.units}`;

const field = (record: Json | undefined, name: string) => (isRecord(record) ? record[name] : null);

export const sampleProblems = async (
  graphs: SeedGraph[],
  tables: SeedTable[],
  nodes: NodeDef[]
): Promise<string[]> => {
  const byKey = new Map(tables.map((t) => [t.key, t]));
  const defs = new Map(
    graphs.map((g) => [
      g.key,
      inlineTables(g.definition as GraphDef, (key) => {
        const t = byKey.get(key);
        return t && { kind: t.kind, definition: t.definition };
      })
    ])
  );
  const run = (key: string, inputs: Record<string, Json>) =>
    runRule({ nodes, graphs: (ref) => defs.get(ref.type) }, { type: key, version: 1 }, inputs, NOW);
  const billed = async (encounter: Json): Promise<Expected> => {
    const trip = await run('billing.trip-classification', { encounter });
    const service = await run('billing.service-details', { encounter });
    const places = await run('billing.origin-and-destination', { encounter });
    const payment = field(encounter, 'payment');
    const charges = await run('billing.charge-lines', {
      classification: trip.classification ?? null,
      level: service.level ?? null,
      emergency: service.emergency ?? null,
      loadedMiles: service.loadedMiles ?? null,
      originCode: places.originCode ?? null,
      destinationCode: places.destinationCode ?? null,
      transportMethod: field(encounter, 'transportMethod') ?? null,
      patientsTransported: field(encounter, 'patientsTransported') ?? null,
      transportReason: field(payment, 'transportReason') ?? null,
      closestFacilityMiles: field(payment, 'closestFacilityMiles') ?? null
    });
    return {
      classification: String(trip.classification),
      lines: (charges.lines as Line[]).map(lineText)
    };
  };
  const files = fs.readdirSync(SAMPLES).filter((f) => f.endsWith('.xml'));
  const problems = await Promise.all(
    files.map(async (file) => {
      const expected = EXPECTED[file];
      if (!expected) return [`${file}: no expected billing`];
      const { reports } = parseDataset(fs.readFileSync(`${SAMPLES}/${file}`, 'utf8'));
      try {
        const actual = await Promise.all(reports.map((r) => billed(toEncounter(r) as Json)));
        return JSON.stringify(actual) === JSON.stringify(expected)
          ? []
          : [`${file}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
      } catch (err) {
        return [`${file}: ${err instanceof Error ? err.message : String(err)}`];
      }
    })
  );
  return [
    ...problems.flat(),
    ...Object.keys(EXPECTED)
      .filter((f) => !files.includes(f))
      .map((f) => `${f}: expected billing for a sample that is gone`)
  ];
};
