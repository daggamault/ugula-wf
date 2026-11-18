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

type Expected = {
  classification: string;
  lines: string[];
  payers?: string[];
  checks?: string[];
  claimChecks?: string[];
};

const SAMPLES = '.xmls';

const NOW = new Date('2026-11-17T00:00:00Z');

const A0998_CHECK =
  'Medicare is billed first for treatment without transport (A0998), which Medicare does not pay: bill the patient or another payer, or expect a denial';

const COVERAGE_CHECK =
  'The payment method names an insurer, but the report gives no insurance: find the coverage before billing the patient';

const MSP_CHECK =
  'Medicare is billed first on a work injury or transport accident: confirm with the Medicare Secondary Payer questionnaire who pays first';

const NO_PCS =
  'Non-emergency transport without a physician certification statement (PCS): get one before billing';

const NO_PRIOR_AUTHORIZATION =
  'Scheduled non-emergency dialysis transport without a prior authorization number: repetitive scheduled transports need one';

const SIGNATURE_EXCEPTION =
  'The patient could not sign the release for billing: get the receiving facility signature or record for the signature exception (42 CFR 424.36)';

const STALE_PCS =
  'The physician certification statement is dated more than 60 days before the service';

const UNSIGNED =
  'No signed release for billing: get the patient or a representative to sign (42 CFR 424.36)';

const EXPECTED: Record<string, Expected[]> = {
  'als1-iv-solutions.xml': [
    { classification: 'emergency', lines: ['A0427-EH x1', 'A0425-EH x6.4'], payers: ['Medicaid'] }
  ],
  'als2-cardiac-arrest.xml': [
    { classification: 'emergency', lines: ['A0433-RH x1', 'A0425-RH x5.4'], payers: ['Medicare'] }
  ],
  'als2-iv-medications.xml': [
    { classification: 'emergency', lines: ['A0433-PH x1', 'A0425-PH x6.9'], payers: ['Blue Plan'] }
  ],
  'auto-accident-msp.xml': [
    {
      classification: 'emergency',
      lines: ['A0427-SH x1', 'A0425-SH x4.6'],
      payers: ['Medicare', 'Keystone Auto'],
      checks: [MSP_CHECK]
    }
  ],
  'batch-three-reports.xml': [
    { classification: 'emergency', lines: ['A0429-SH x1', 'A0425-SH x8.3'], payers: ['Blue Plan'] },
    { classification: 'notBillable', lines: ['A0429 x1'], claimChecks: [UNSIGNED] },
    {
      classification: 'treatNoTransport',
      lines: ['A0998 x1'],
      payers: ['Medicare'],
      checks: [A0998_CHECK]
    }
  ],
  'bls-emergency-commercial-corrected.xml': [
    { classification: 'emergency', lines: ['A0429-SH x1', 'A0425-SH x10.1'], payers: ['Blue Plan'] }
  ],
  'bls-emergency-commercial.xml': [
    { classification: 'emergency', lines: ['A0429-SH x1', 'A0425-SH x8.3'], payers: ['Blue Plan'] }
  ],
  'cancelled-prior-to-arrival.xml': [
    { classification: 'notBillable', lines: ['A0429 x1'], claimChecks: [UNSIGNED] }
  ],
  'contract-facility.xml': [
    {
      classification: 'scheduled',
      lines: ['A0429-EH x1', 'A0425-EH x4.6'],
      payers: ['Simulated Medicare Part B']
    }
  ],
  'critical-care-scene.xml': [
    { classification: 'emergency', lines: ['A0427-RH x1', 'A0425-RH x6.3'], payers: ['Blue Plan'] }
  ],
  'dead-at-scene-ql.xml': [
    {
      classification: 'pronouncedDead',
      lines: ['A0429-RH-QL x1'],
      payers: ['Simulated Medicare Part B']
    }
  ],
  'dependent-secondary-coverage.xml': [
    {
      classification: 'emergency',
      lines: ['A0429-SH x1', 'A0425-SH x5.8'],
      payers: ['Blue Plan', 'Medicaid']
    }
  ],
  'emergent-interfacility.xml': [
    { classification: 'scheduled', lines: ['A0427-HH x1', 'A0425-HH x13.6'], payers: ['Medicare'] }
  ],
  'farther-facility-a0888.xml': [
    {
      classification: 'emergency',
      lines: ['A0427-RH x1', 'A0425-RH x2', 'A0888-RH x2.6'],
      payers: ['Simulated Medicare Part B']
    }
  ],
  'long-distance-stale-pcs.xml': [
    {
      classification: 'scheduled',
      lines: ['A0428-HH x1', 'A0425-HH x124'],
      payers: ['Medicare'],
      claimChecks: [STALE_PCS]
    }
  ],
  'medicaid-by-payment-method-unsigned.xml': [
    {
      classification: 'emergency',
      lines: ['A0429-RH x1', 'A0425-RH x4.5'],
      checks: [COVERAGE_CHECK],
      claimChecks: [UNSIGNED]
    }
  ],
  'missing-disposition.xml': [
    { classification: 'emergency', lines: ['A0429-SH x1', 'A0425-SH x8.3'], payers: ['Blue Plan'] }
  ],
  'missing-patient-details.xml': [
    {
      classification: 'emergency',
      lines: ['A0429-RH x1', 'A0425-RH x5.3'],
      payers: ['Blue Plan'],
      claimChecks: [SIGNATURE_EXCEPTION]
    }
  ],
  'multiple-patients-gm.xml': [
    {
      classification: 'emergency',
      lines: ['A0427-RH-GM x1', 'A0425-RH-GM x4.6'],
      payers: ['Simulated Medicare Part B']
    }
  ],
  'nemsis-34-emergency.xml': [
    { classification: 'emergency', lines: ['A0427-RH x1', 'A0425-RH x6.9'], payers: ['Medicare'] }
  ],
  'new-patient-medicare.xml': [
    {
      classification: 'emergency',
      lines: ['A0427-RH x1', 'A0425-RH x4.6'],
      payers: ['Simulated Medicare Part B']
    }
  ],
  'refusal-unsigned.xml': [
    {
      classification: 'refusal',
      lines: ['A0998 x1'],
      payers: ['Blue Plan'],
      claimChecks: [UNSIGNED]
    }
  ],
  'rescue-no-patient-care.xml': [
    { classification: 'notBillable', lines: ['A0429 x1'], claimChecks: [UNSIGNED] }
  ],
  'scheduled-dialysis-pcs.xml': [
    {
      classification: 'scheduled',
      lines: ['A0428-RJ x1', 'A0425-RJ x5.9'],
      payers: ['Medicare'],
      claimChecks: [NO_PRIOR_AUTHORIZATION]
    }
  ],
  'scheduled-missing-pcs.xml': [
    {
      classification: 'scheduled',
      lines: ['A0428-HN x1', 'A0425-HN x8.5'],
      payers: ['Medicare'],
      claimChecks: [NO_PCS]
    }
  ],
  'sct-interfacility.xml': [
    { classification: 'scheduled', lines: ['A0434-HH x1', 'A0425-HH x42.2'], payers: ['Blue Plan'] }
  ],
  'short-trip-self-pay.xml': [
    { classification: 'emergency', lines: ['A0429-RH x1', 'A0425-RH x0.4'] }
  ],
  'treat-no-transport-medicare.xml': [
    {
      classification: 'treatNoTransport',
      lines: ['A0998 x1'],
      payers: ['Medicare'],
      checks: [A0998_CHECK]
    }
  ],
  'unclear-trip.xml': [{ classification: 'unknown', lines: ['A0429 x1'], payers: ['Blue Plan'] }],
  'work-injury-msp.xml': [
    {
      classification: 'emergency',
      lines: ['A0427-RH x1', 'A0425-RH x4.6'],
      payers: ['Keystone Comp', 'Simulated Medicare Part B']
    }
  ]
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
    const order = await run('billing.billing-order', {
      insurances: field(encounter, 'insurances') ?? []
    });
    const checks = await run('billing.payer-checks', {
      encounter,
      classification: trip.classification ?? null,
      insurances: order.insurances ?? []
    });
    const dx = await run('billing.diagnoses', { encounter });
    const claimChecks = await run('billing.claim-checks', {
      encounter,
      classification: trip.classification ?? null,
      emergency: service.emergency ?? null,
      serviceDate: service.serviceDate ?? null,
      diagnoses: dx.diagnoses ?? []
    });
    const payers = (order.insurances as Json[]).map((i) => String(field(i, 'companyName')));
    return {
      classification: String(trip.classification),
      lines: (charges.lines as Line[]).map(lineText),
      ...(payers.length ? { payers } : {}),
      ...((checks.reasons as string[]).length ? { checks: checks.reasons as string[] } : {}),
      ...((claimChecks.reasons as string[]).length
        ? { claimChecks: claimChecks.reasons as string[] }
        : {})
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
