import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type ClaimEvent,
  type ClaimStore,
  createBillingNodes,
  type FeeStore,
  type PatientStore
} from '@ugula/billing';
import {
  combineSources,
  createEngine,
  createStdNodes,
  ENTRY_TYPE,
  type GraphDef,
  getPath,
  type Json,
  RETURN_TYPE,
  refKey,
  stdGraphSource
} from '@ugula/graph';
import { parseDataset } from '@ugula/nemsis';
import { billingGraphs } from './billing-graphs.ts';
import { assertValidGraphs, graphNodes } from './seed.ts';

const now = new Date('2026-10-01T00:00:00.000Z');

const REPORT = `<EMSDataSet xmlns="http://www.nemsis.org"><Header><PatientCareReport>
  <ePatient><ePatient.05>1 Main St</ePatient.05><ePatient.06>2395220</ePatient.06><ePatient.08>17</ePatient.08><ePatient.09>62704</ePatient.09><ePatient.25>9919003</ePatient.25></ePatient>
  <eScene><eScene.15>9 Elm St</eScene.15><eScene.17>Springfield</eScene.17><eScene.18>17</eScene.18><eScene.19>62701</eScene.19></eScene>
  <eResponse><eResponse.20>100.0</eResponse.20><eResponse.21>104.25</eResponse.21><eResponse.23>2223001</eResponse.23></eResponse>
  <eMedications>
    <eMedications.MedicationGroup><eMedications.04>9927023</eMedications.04></eMedications.MedicationGroup>
    <eMedications.MedicationGroup><eMedications.04>9927035</eMedications.04></eMedications.MedicationGroup>
    <eMedications.MedicationGroup><eMedications.04>9927021</eMedications.04></eMedications.MedicationGroup>
    <eMedications.MedicationGroup><eMedications.04>9927069</eMedications.04></eMedications.MedicationGroup>
  </eMedications>
  <eDisposition><eDisposition.01>St. Mary</eDisposition.01><eDisposition.03>1 Hospital Way</eDisposition.03><eDisposition.05>17</eDisposition.05><eDisposition.07>62702</eDisposition.07><eDisposition.32>4232005</eDisposition.32></eDisposition>
  <ePayment>
    <ePayment.01>2601001</ePayment.01>
    <ePayment.InsuranceGroup><ePayment.10>Acme Health</ePayment.10><ePayment.11>2611005</ePayment.11></ePayment.InsuranceGroup>
    <ePayment.InsuranceGroup><ePayment.09>BCBS1</ePayment.09><ePayment.10>Blue Plan</ePayment.10><ePayment.11>2611003</ePayment.11><ePayment.17>G7</ePayment.17><ePayment.18>XYZ123</ePayment.18></ePayment.InsuranceGroup>
  </ePayment>
</PatientCareReport></Header></EMSDataSet>`;

const engineFor = (main: GraphDef) => {
  const graphs = new Map(
    billingGraphs.map((g) => [refKey({ type: g.key, version: g.version }), g])
  );
  return createEngine({
    nodes: graphNodes(),
    graphs: combineSources(stdGraphSource, (ref) =>
      ref.type === 'test.main' ? main : graphs.get(refKey(ref))?.definition
    )
  });
};

const summarize = async (report: Json) => {
  const main: GraphDef = {
    signature: {
      execIn: ['exec'],
      execOut: [],
      inputs: [],
      outputs: [{ name: 'summary', type: 'any' }]
    },
    variables: [],
    nodes: [
      { id: 'entry', type: ENTRY_TYPE, version: 1 },
      { id: 'sum', type: 'billing.pcr-summary', version: 1, inputs: { report: { value: report } } },
      { id: 'ret', type: RETURN_TYPE, version: 1 }
    ],
    edges: [
      { from: 'entry', fromPin: 'exec', to: 'ret', toPin: 'exec' },
      { from: 'sum', fromPin: 'summary', to: 'ret', toPin: 'summary' }
    ]
  };
  const engine = engineFor(main);
  const state = engine.start({ type: 'test.main', version: 1 }, {}, { now });
  await engine.drain(state, { runId: 'r', now });
  assert.equal(state.status, 'completed', state.fault?.error.message ?? '');
  return state.result?.outputs.summary as Record<string, Json>;
};

const linesFor = async (summary: Record<string, Json>) => {
  const main: GraphDef = {
    signature: {
      execIn: ['exec'],
      execOut: [],
      inputs: [],
      outputs: [
        { name: 'service', type: 'any' },
        { name: 'lines', type: 'any' }
      ]
    },
    variables: [],
    nodes: [
      { id: 'entry', type: ENTRY_TYPE, version: 1 },
      {
        id: 'los',
        type: 'billing.level-of-service',
        version: 1,
        inputs: { summary: { value: summary } }
      },
      { id: 'lines', type: 'billing.claim-lines', version: 1 },
      { id: 'ret', type: RETURN_TYPE, version: 1 }
    ],
    edges: [
      { from: 'entry', fromPin: 'exec', to: 'ret', toPin: 'exec' },
      { from: 'los', fromPin: 'service', to: 'lines', toPin: 'service' },
      { from: 'los', fromPin: 'service', to: 'ret', toPin: 'service' },
      { from: 'lines', fromPin: 'lines', to: 'ret', toPin: 'lines' }
    ]
  };
  const engine = engineFor(main);
  const state = engine.start({ type: 'test.main', version: 1 }, {}, { now });
  await engine.drain(state, { runId: 'r', now });
  assert.equal(state.status, 'completed', state.fault?.error.message ?? '');
  return state.result?.outputs;
};

describe('billing graphs', () => {
  it('validate against std, NEMSIS and billing nodes in dependency order', () => {
    assert.doesNotThrow(() => assertValidGraphs(billingGraphs, graphNodes()));
    assert.deepEqual(
      billingGraphs.map((g) => g.key),
      [
        'billing.pcr-summary',
        'billing.resolve-patient',
        'billing.level-of-service',
        'billing.claim-lines',
        'billing.cycle-claim',
        'billing.process-pcr',
        'billing.ingest-nemsis'
      ]
    );
  });

  it('cycles a claim through its payers, follow-ups and spaced patient statements until paid', async () => {
    const DAY = 86_400_000;
    let clock = new Date('2026-01-01T00:00:00.000Z');
    const at = (days: number) => {
      clock = new Date(Date.parse('2026-01-01T00:00:00.000Z') + days * DAY);
    };
    const events: ClaimEvent[] = [];
    const closed: string[] = [];
    const claims: ClaimStore = {
      openClaim: async () => 'c1',
      attachCycle: async () => undefined,
      statementData: async () => ({
        agency: {
          name: 'Agency',
          addressLine: null,
          city: null,
          state: null,
          postalCode: null,
          phone: '2175550100'
        },
        patient: { name: 'Jane Doe', addressLine: null, city: null, state: null, postalCode: null },
        reference: 'PCR-1',
        serviceDate: null,
        lines: [],
        totalCents: 100_000,
        payments: [],
        balanceCents: 100_000
      }),
      saveStatement: async (_, __, ___, { pdf }) => {
        assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), '%PDF-');
        events.push({
          kind: 'statement',
          coverageId: null,
          paidCents: 0,
          adjustedCents: 0,
          at: clock.toISOString()
        });
      },
      ledger: async () => ({
        totalCents: 100_000,
        coverages: [{ id: 'cov-1', payer: 'Medicare' }],
        events
      }),
      recordEvent: async (_, __, ___, e) => {
        events.push({
          kind: e.kind,
          coverageId: e.coverageId,
          paidCents: 0,
          adjustedCents: 0,
          at: clock.toISOString()
        });
      },
      closeClaim: async (_, __, ___, status) => {
        closed.push(status);
      }
    };
    const pay = (paidCents: number) =>
      events.push({
        kind: 'response',
        coverageId: null,
        paidCents,
        adjustedCents: 0,
        at: clock.toISOString()
      });
    const graphs = new Map(
      billingGraphs.map((g) => [refKey({ type: g.key, version: g.version }), g.definition])
    );
    const engine = createEngine({
      nodes: [
        ...createStdNodes({ fetch }),
        ...createBillingNodes({ claims, patients: {} as PatientStore, fees: {} as FeeStore })
      ],
      graphs: combineSources(stdGraphSource, (ref) => graphs.get(refKey(ref)))
    });
    const state = engine.start(
      { type: 'billing.cycle-claim', version: 1 },
      { claimId: 'c1' },
      { now: clock }
    );
    const waitFor = async (kind: string) => {
      await engine.drain(state, { runId: 'r', now: clock });
      assert.equal(state.suspension?.kind, kind, state.fault?.error.message ?? '');
      return state.suspension?.id ?? '';
    };
    const kinds = () => events.map((e) => e.kind);

    const sent = (kind: ClaimEvent['kind']) =>
      events.push({
        kind,
        coverageId: 'cov-1',
        paidCents: 0,
        adjustedCents: 0,
        at: clock.toISOString()
      });

    let wait = await waitFor('signal');
    assert.deepEqual(state.suspension?.data, {
      name: 'claim',
      key: 'c1',
      until: '2026-01-02T00:00:00.000Z'
    });
    engine.resume(state, wait, { timedOut: true });
    wait = await waitFor('signal');
    assert.deepEqual(kinds(), []);
    sent('submitted');
    engine.resume(state, wait, { payload: null });
    wait = await waitFor('signal');

    at(30);
    engine.resume(state, wait, { timedOut: true });
    let followUp = await waitFor('task');
    assert.deepEqual(getPath(state.suspension?.data ?? null, 'context'), {
      claimId: 'c1',
      coverageId: 'cov-1',
      payer: 'Medicare',
      balanceCents: 100_000
    });
    engine.resume(state, followUp, { outcome: 'resubmit', values: {} });
    wait = await waitFor('signal');
    assert.deepEqual(kinds(), ['submitted', 'resubmit_queued']);
    sent('resubmitted');
    engine.resume(state, wait, { payload: null });
    wait = await waitFor('signal');

    at(60);
    engine.resume(state, wait, { timedOut: true });
    followUp = await waitFor('task');
    engine.resume(state, followUp, { outcome: 'nextPayer', values: {} });
    wait = await waitFor('signal');
    assert.deepEqual(kinds(), [
      'submitted',
      'resubmit_queued',
      'resubmitted',
      'payer_skipped',
      'statement'
    ]);

    at(61);
    pay(5_000);
    engine.resume(state, wait, { payload: null });
    wait = await waitFor('signal');
    assert.equal(kinds().at(-1), 'response');

    at(90);
    engine.resume(state, wait, { timedOut: true });
    wait = await waitFor('signal');
    assert.equal(kinds().filter((k) => k === 'statement').length, 2);

    pay(95_000);
    engine.resume(state, wait, { payload: null });
    await engine.drain(state, { runId: 'r', now: clock });
    assert.equal(state.status, 'completed', state.fault?.error.message ?? '');
    assert.deepEqual(closed, ['paid']);
  });

  it('summarizes care level, IV/IO medications and the primary payer from a NEMSIS report', async () => {
    const [report] = parseDataset(REPORT).reports;
    const summary = await summarize(report ?? null);
    assert.equal(summary.careLevel, '4232005');
    assert.equal(summary.ivMedicationCount, 3);
    assert.equal(summary.payer, 'Blue Plan');
    assert.equal(summary.responseMode, '2223001');
    assert.equal(summary.gender, '9919003');
    assert.deepEqual(
      [summary.addressLine, summary.city, summary.state, summary.postalCode],
      ['1 Main St', '2395220', '17', '62704']
    );
    assert.deepEqual(summary.pickup, {
      addressLine: '9 Elm St',
      city: 'Springfield',
      state: '17',
      postalCode: '62701'
    });
    assert.equal((summary.destination as Record<string, Json>).name, 'St. Mary');
    assert.deepEqual((summary.coverages as Json[])[1], {
      payer: 'Blue Plan',
      payerCode: 'BCBS1',
      priority: '2611003',
      memberId: 'XYZ123',
      groupId: 'G7'
    });
    const medicare = await summarize({ ePayment: { 'ePayment.01': '2601005' } });
    assert.equal(medicare.payer, 'Medicare');
    assert.equal(medicare.ivMedicationCount, 0);
    assert.equal((await summarize({})).payer, null);
  });

  it('suggests the level of service and maps it to HCPCS lines with loaded mileage', async () => {
    assert.deepEqual(
      await linesFor({
        careLevel: '4232005',
        responseMode: '2223001',
        sceneOdometer: '1000.0',
        destinationOdometer: '1012.37',
        ivMedicationCount: 1
      }),
      {
        service: { level: 'ALS1', emergency: true, loadedMiles: 12.4 },
        lines: [
          { code: 'A0427', units: 1 },
          { code: 'A0425', units: 12.4 }
        ]
      }
    );
    assert.deepEqual(
      await linesFor({ careLevel: '4232005', responseMode: '2223005', ivMedicationCount: 3 }),
      {
        service: { level: 'ALS2', emergency: false, loadedMiles: null },
        lines: [{ code: 'A0433', units: 1 }]
      }
    );
    assert.deepEqual((await linesFor({ careLevel: '4232001', ivMedicationCount: 0 }))?.lines, [
      { code: 'A0428', units: 1 }
    ]);
    assert.deepEqual((await linesFor({ careLevel: '4232009', ivMedicationCount: 0 }))?.lines, [
      { code: 'A0434', units: 1 }
    ]);
  });
});
