import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type BillingStores,
  type BlobRef,
  type ClaimEvent,
  type ClaimStore,
  createBillingNodes,
  type FeeStore,
  type NewClaim,
  type Patient,
  type PatientStore,
  type PayerStore
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
  type RunState,
  refKey,
  stdGraphSource
} from '@ugula/graph';
import { createNemsisNodes, parseDataset, type ReportStore } from '@ugula/nemsis';
import { billingGraphs } from './billing-graphs.ts';
import { assertValidGraphs, graphNodes } from './seed.ts';

const now = new Date('2026-10-01T00:00:00.000Z');

const REPORT = `<EMSDataSet xmlns="http://www.nemsis.org"><Header><PatientCareReport>
  <eRecord><eRecord.01>PCR-1</eRecord.01></eRecord>
  <ePatient><ePatient.02>Doe</ePatient.02><ePatient.03>Jane</ePatient.03><ePatient.05>1 Main St</ePatient.05><ePatient.06>2395220</ePatient.06><ePatient.08>17</ePatient.08><ePatient.09>62704</ePatient.09><ePatient.17>1980-01-02</ePatient.17><ePatient.25>9919003</ePatient.25></ePatient>
  <eScene><eScene.15>9 Elm St</eScene.15><eScene.17>Springfield</eScene.17><eScene.18>17</eScene.18><eScene.19>62701</eScene.19></eScene>
  <eResponse><eResponse.20>100.0</eResponse.20><eResponse.21>104.25</eResponse.21><eResponse.23>2223001</eResponse.23></eResponse>
  <eMedications>
    <eMedications.MedicationGroup><eMedications.04>9927023</eMedications.04></eMedications.MedicationGroup>
    <eMedications.MedicationGroup><eMedications.04>9927035</eMedications.04></eMedications.MedicationGroup>
    <eMedications.MedicationGroup><eMedications.04>9927021</eMedications.04></eMedications.MedicationGroup>
    <eMedications.MedicationGroup><eMedications.04>9927069</eMedications.04></eMedications.MedicationGroup>
  </eMedications>
  <eNarrative><eNarrative.01>Fentanyl 50 mcg IV x2 for pain.</eNarrative.01></eNarrative>
  <eDisposition><eDisposition.01>St. Mary</eDisposition.01><eDisposition.03>1 Hospital Way</eDisposition.03><eDisposition.05>17</eDisposition.05><eDisposition.07>62702</eDisposition.07><eDisposition.32>4232005</eDisposition.32></eDisposition>
  <ePayment>
    <ePayment.01>2601001</ePayment.01>
    <ePayment.InsuranceGroup><ePayment.10>Acme Health</ePayment.10><ePayment.11>2611005</ePayment.11></ePayment.InsuranceGroup>
    <ePayment.InsuranceGroup><ePayment.09>BCBS1</ePayment.09><ePayment.10>Blue Plan</ePayment.10><ePayment.11>2611003</ePayment.11><ePayment.17>G7</ePayment.17><ePayment.18>XYZ123</ePayment.18></ePayment.InsuranceGroup>
  </ePayment>
</PatientCareReport></Header></EMSDataSet>`;

const [REPORT_DATA = null] = parseDataset(REPORT).reports;

const graphSource = (main?: GraphDef) => {
  const graphs = new Map(
    billingGraphs.map((g) => [refKey({ type: g.key, version: g.version }), g.definition])
  );
  return combineSources(stdGraphSource, (ref) =>
    ref.type === 'test.main' ? main : graphs.get(refKey(ref))
  );
};

const engineFor = (main: GraphDef) =>
  createEngine({ nodes: graphNodes(), graphs: graphSource(main) });

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

const NO_FINDINGS = { medications: [], procedures: [], ivDoses: 0 };

const linesFor = async (summary: Record<string, Json>, findings: Json = NO_FINDINGS) => {
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
        inputs: { summary: { value: summary }, findings: { value: findings } }
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

const only = <T extends object>(impl: Partial<T> = {}) =>
  new Proxy(impl, {
    get: (target, name) =>
      Object.hasOwn(target, name)
        ? target[name as keyof typeof target]
        : () => {
            throw new Error(`${String(name)} should not be called`);
          }
  }) as T;

const pcrWorld = (opts: { billed?: string; duplicate?: boolean; known?: Patient[] } = {}) => {
  const report = { bucket: 'ugula', key: 'imports/t/f.xml.reports/00000.json' };
  const opened: NewClaim[] = [];
  const revisions: [string, BlobRef][] = [];
  const priced: (string | null)[] = [];
  const aliases = new Map<string, string>();
  const blue = { id: 'p-blue', name: 'Blue Plan', claimFiling: 'BL' };
  const acme = { id: 'p-acme', name: 'Acme Health Plan', claimFiling: 'CI' };
  const payers: PayerStore = {
    lookup: async (_, names) =>
      names.map((name) => {
        const alias = aliases.get(name);
        if (name === blue.name || alias === blue.id) return { name, known: blue, candidates: [] };
        if (alias === acme.id) return { name, known: acme, candidates: [] };
        return {
          name,
          known: null,
          candidates: [
            { ...blue, similarity: 0.61 },
            { ...acme, similarity: 0.6 }
          ]
        };
      }),
    linkAlias: async (_, name, payerId) => {
      aliases.set(name, payerId);
    }
  };
  const patients: PatientStore = {
    findCandidates: async () => opts.known ?? [],
    findPatient: async (_, id) => opts.known?.find((p) => p.id === id) ?? null,
    createPatient: async (_, __, p) => ({ id: 'p-new', ...p })
  };
  const fees: FeeStore = {
    findFees: async (_, payerId, codes) => {
      priced.push(payerId);
      return Object.fromEntries(codes.map((c) => [c, 10_000]));
    }
  };
  const claims = only<ClaimStore>({
    findByPcr: async () => opts.billed ?? null,
    openClaim: async (_, __, claim) => {
      opened.push(claim);
      return { id: 'c1', duplicate: opts.duplicate === true };
    },
    noteRevision: async (_, claimId, __, blob) => {
      revisions.push([claimId, blob]);
    },
    attachCycle: async () => undefined
  });
  const stores: BillingStores = {
    patients,
    payers,
    fees,
    claims,
    completer: {
      complete: async (r) =>
        r.user.startsWith('Report payer:')
          ? { choice: 2 }
          : { medications: [{ medication: 'fentanyl', route: 'IV', doses: 2 }], procedures: [] }
    }
  };
  const engine = createEngine({
    nodes: [
      ...createStdNodes({ fetch }),
      ...createNemsisNodes(only<ReportStore>({ getJson: async () => REPORT_DATA })),
      ...createBillingNodes(stores)
    ],
    graphs: graphSource()
  });
  const state = engine.start({ type: 'billing.process-pcr', version: 1 }, { report }, { now });
  const waitFor = async (kind: string, title?: string) => {
    await engine.drain(state, { runId: 'r', now });
    assert.equal(state.suspension?.kind, kind, state.fault?.error.message ?? '');
    if (title) assert.equal(getPath(state.suspension?.data ?? null, 'title'), title);
    return state.suspension?.id ?? '';
  };
  const answer = (wait: string, outcome: string, values: Record<string, Json> = {}) =>
    engine.resume(state, wait, { outcome, values });
  const finish = async (s: RunState) => {
    await engine.drain(s, { runId: 'r', now });
    assert.equal(s.status, 'completed', s.fault?.error.message ?? '');
    return s.result?.outputs ?? {};
  };
  const data = (path: string) => getPath(state.suspension?.data ?? null, path);
  return {
    engine,
    state,
    waitFor,
    answer,
    finish,
    data,
    report,
    opened,
    revisions,
    priced,
    aliases
  };
};

describe('billing graphs', () => {
  it('validate against std, NEMSIS and billing nodes in dependency order', () => {
    assert.doesNotThrow(() => assertValidGraphs(billingGraphs, graphNodes()));
    assert.deepEqual(
      billingGraphs.map((g) => g.key),
      [
        'billing.pcr-summary',
        'billing.resolve-patient',
        'billing.resolve-payers',
        'billing.level-of-service',
        'billing.claim-lines',
        'billing.cycle-claim',
        'billing.process-pcr',
        'billing.ingest-nemsis'
      ]
    );
  });

  it('processes a new PCR: payers learned, narrative considered, held, released and billed', async () => {
    const world = pcrWorld();
    const payer = await world.waitFor('task', 'Match payer');
    assert.equal(world.data('queue'), 'billing-payers');
    assert.equal(world.data('subject'), 'PCR-1 · Acme Health');
    assert.deepEqual(world.data('context'), {
      reportedPayer: 'Acme Health',
      memberId: null,
      patient: 'Jane Doe',
      pcrNumber: 'PCR-1'
    });
    assert.deepEqual(world.data('defaults'), { payerId: 'p-acme' });
    assert.deepEqual(world.data('fields'), [
      {
        name: 'payerId',
        type: 'string',
        label: 'Directory payer',
        options: [
          { value: 'p-acme', label: 'Acme Health Plan (Commercial insurance) · suggested' },
          { value: 'p-blue', label: 'Blue Plan (Blue Cross/Blue Shield)' }
        ]
      }
    ]);
    world.answer(payer, 'link', { payerId: 'p-acme' });
    assert.deepEqual([...world.aliases], []);

    let review = await world.waitFor('task', 'Review PCR');
    assert.equal(world.data('subject'), 'PCR-1 · Jane Doe');
    assert.deepEqual([...world.aliases], [['Acme Health', 'p-acme']]);
    assert.deepEqual(world.data('context.coverage'), [
      { payer: 'Blue Plan', directory: 'Blue Plan', memberId: 'XYZ123', groupId: 'G7' },
      { payer: 'Acme Health', directory: 'Acme Health Plan', memberId: null, groupId: null }
    ]);
    assert.deepEqual(world.data('context.narrative'), {
      medications: ['fentanyl IV x2'],
      procedures: []
    });
    assert.deepEqual(world.data('defaults'), {
      level: 'ALS2',
      emergency: true,
      loadedMiles: 4.3,
      basis: [
        'ALS care documented',
        '3 IV/IO medications coded',
        '2 IV/IO medication doses in the narrative'
      ]
    });

    world.answer(review, 'hold', { note: 'Missing signature' });
    const held = await world.waitFor('task', 'Held PCR');
    assert.equal(world.data('queue'), 'billing-holds');
    assert.equal(world.data('context.note'), 'Missing signature');
    world.answer(held, 'release');
    review = await world.waitFor('task', 'Review PCR');
    world.answer(review, 'approve', { level: 'ALS1', loadedMiles: 4.3 });

    const start = await world.waitFor('start');
    assert.deepEqual(world.priced, ['p-blue']);
    const [claim] = world.opened;
    assert.equal(claim?.level, 'ALS1');
    assert.deepEqual(
      claim?.coverages.map((c) => [c.payer, c.payerId]),
      [
        ['Blue Plan', 'p-blue'],
        ['Acme Health', 'p-acme']
      ]
    );
    assert.deepEqual(world.data('inputs'), { claimId: 'c1' });
    world.engine.resume(world.state, start, { runId: 'cycle-1' });
    const outputs = await world.finish(world.state);
    assert.equal(outputs.claimId, 'c1');
    assert.equal(getPath(outputs.charges ?? null, 'totalCents'), 53_000);
  });

  it('treats an already billed PCR as a revision of its claim, never a second claim', async () => {
    const world = pcrWorld({ billed: 'c1' });
    const revision = await world.waitFor('task', 'Review updated PCR');
    assert.deepEqual(world.revisions, [['c1', world.report]]);
    assert.equal(world.data('context.claimId'), 'c1');
    assert.equal(world.data('context.trip.pcrNumber'), 'PCR-1');
    world.answer(revision, 'acknowledge');
    const outputs = await world.finish(world.state);
    assert.deepEqual([outputs.claimId, world.opened.length, world.priced.length], ['c1', 0, 0]);
  });

  it('turns a claim another run opened for the same PCR into a revision', async () => {
    const world = pcrWorld({ duplicate: true });
    world.answer(await world.waitFor('task', 'Match payer'), 'unlisted');
    world.answer(await world.waitFor('task', 'Review PCR'), 'approve');
    world.answer(await world.waitFor('task', 'Review updated PCR'), 'acknowledge');
    assert.deepEqual(world.revisions, [['c1', world.report]]);
    assert.deepEqual([...world.aliases], []);
    assert.equal((await world.finish(world.state)).claimId, 'c1');
  });

  it('asks a biller to confirm a likely patient, showing the report as cleaned and coded', async () => {
    const typo: Patient = {
      id: 'p-jane',
      firstName: 'Jane',
      lastName: 'Doe',
      birthDate: '1980-01-20',
      gender: 'M',
      addressLine: null,
      city: null,
      state: null,
      postalCode: null
    };
    const world = pcrWorld({ known: [typo] });
    const confirm = await world.waitFor('task', 'Confirm patient');
    assert.equal(world.data('subject'), 'PCR-1 · Jane Doe');
    assert.deepEqual(world.data('context'), {
      reason: 'Similar patients found',
      report: {
        name: 'Jane Doe',
        birthDate: '1980-01-02',
        sex: 'Male',
        address: '1 Main St, 62704',
        pcrNumber: 'PCR-1'
      },
      candidates: [{ name: 'Jane Doe', birthDate: '1980-01-20', sex: 'Male', address: '' }]
    });
    world.answer(confirm, 'link', { patientId: 'p-jane' });
    world.answer(await world.waitFor('task', 'Match payer'), 'unlisted');
    await world.waitFor('task', 'Review PCR');
    assert.equal(world.data('context.patient.birthDate'), '1980-01-20');
  });

  it('voids a held PCR without billing it', async () => {
    const world = pcrWorld();
    world.answer(await world.waitFor('task', 'Match payer'), 'unlisted');
    world.answer(await world.waitFor('task', 'Review PCR'), 'hold', { note: 'Duplicate trip' });
    world.answer(await world.waitFor('task', 'Held PCR'), 'void');
    const outputs = await world.finish(world.state);
    assert.deepEqual([outputs.claimId, world.opened.length], [null, 0]);
    assert.equal(getPath(outputs.patient ?? null, 'id'), 'p-new');
  });

  it('spawns one Process PCR run per report and completes without waiting for them', async () => {
    const file = { bucket: 'ugula', key: 'imports/t/f.xml' };
    const engine = createEngine({
      nodes: [
        ...createStdNodes({ fetch }),
        ...createNemsisNodes({
          getText: async () => REPORT.replace('</Header>', '<PatientCareReport/></Header>'),
          getJson: async () => null,
          putJson: async (_, key) => ({ bucket: 'ugula', key, size: 1, contentType: 'json' }),
          recordReports: async () => undefined
        }),
        ...createBillingNodes(null)
      ],
      graphs: graphSource()
    });
    const state = engine.start({ type: 'billing.ingest-nemsis', version: 1 }, { file }, { now });
    await engine.drain(state, { runId: 'r', now });
    assert.equal(state.suspension?.kind, 'spawn');
    assert.deepEqual(
      (getPath(state.suspension?.data ?? null, 'items') as Json[]).map((i) =>
        getPath(i, 'report.key')
      ),
      ['imports/t/f.xml.reports/00000.json', 'imports/t/f.xml.reports/00001.json']
    );
    engine.resume(state, state.suspension?.id ?? '', { runIds: ['a', 'b'] });
    await engine.drain(state, { runId: 'r', now });
    assert.deepEqual(state.result?.outputs, { count: 2, runIds: ['a', 'b'] });
  });

  it('cycles a claim through its payers, follow-ups and spaced patient statements until paid', async () => {
    const DAY = 86_400_000;
    let clock = new Date('2026-01-01T00:00:00.000Z');
    const at = (days: number) => {
      clock = new Date(Date.parse('2026-01-01T00:00:00.000Z') + days * DAY);
    };
    const events: ClaimEvent[] = [];
    const closed: string[] = [];
    const claims = only<ClaimStore>({
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
        events,
        signalsSeen: events.length,
        reference: 'PCR-1 · Jane Doe'
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
    });
    const pay = (paidCents: number) =>
      events.push({
        kind: 'response',
        coverageId: null,
        paidCents,
        adjustedCents: 0,
        at: clock.toISOString()
      });
    const engine = createEngine({
      nodes: [
        ...createStdNodes({ fetch }),
        ...createBillingNodes({
          claims,
          patients: only(),
          payers: only(),
          fees: only(),
          completer: only()
        })
      ],
      graphs: graphSource()
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
    assert.deepEqual(state.suspension?.data, { name: 'claim', key: 'c1', until: null, after: 0 });
    sent('submitted');
    engine.resume(state, wait, { payload: null });
    wait = await waitFor('signal');
    assert.deepEqual(state.suspension?.data, {
      name: 'claim',
      key: 'c1',
      until: '2026-01-31T00:00:00.000Z',
      after: 1
    });

    at(30);
    engine.resume(state, wait, { timedOut: true });
    let followUp = await waitFor('task');
    assert.equal(getPath(state.suspension?.data ?? null, 'subject'), 'PCR-1 · Jane Doe · Medicare');
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
    assert.equal(getPath(state.suspension?.data ?? null, 'until'), '2026-04-01T00:00:00.000Z');

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

  it('summarizes care level, IV/IO medications, narrative and the primary payer from a NEMSIS report', async () => {
    const summary = await summarize(REPORT_DATA);
    assert.equal(summary.pcrNumber, 'PCR-1');
    assert.equal(summary.careLevel, '4232005');
    assert.equal(summary.ivMedicationCount, 3);
    assert.equal(summary.narrative, 'Fentanyl 50 mcg IV x2 for pain.');
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

  it('suggests the level of service with its reasons and maps it to HCPCS lines', async () => {
    assert.deepEqual(
      await linesFor({
        careLevel: '4232005',
        responseMode: '2223001',
        sceneOdometer: '1000.0',
        destinationOdometer: '1012.37',
        ivMedicationCount: 1
      }),
      {
        service: {
          level: 'ALS1',
          emergency: true,
          loadedMiles: 12.4,
          basis: ['ALS care documented', '1 IV/IO medications coded']
        },
        lines: [
          { code: 'A0427', units: 1 },
          { code: 'A0425', units: 12.4 }
        ]
      }
    );
    assert.deepEqual(
      await linesFor({ careLevel: '4232005', responseMode: '2223005', ivMedicationCount: 3 }),
      {
        service: {
          level: 'ALS2',
          emergency: false,
          loadedMiles: null,
          basis: ['ALS care documented', '3 IV/IO medications coded']
        },
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

  it('raises the suggestion when the narrative documents more than the coded data', async () => {
    const bls = { careLevel: '4232001', ivMedicationCount: 0 };
    const pushed = await linesFor(bls, { medications: [], procedures: [], ivDoses: 1 });
    assert.deepEqual(getPath(pushed?.service ?? null, 'level'), 'ALS1');
    assert.deepEqual(getPath(pushed?.service ?? null, 'basis'), [
      'BLS care documented',
      '1 IV/IO medication doses in the narrative'
    ]);
    const intubated = await linesFor(bls, {
      medications: [],
      procedures: ['endotracheal intubation'],
      ivDoses: 0
    });
    assert.equal(getPath(intubated?.service ?? null, 'level'), 'ALS2');
    assert.deepEqual(getPath(intubated?.service ?? null, 'basis'), [
      'BLS care documented',
      'Narrative ALS2 procedures: endotracheal intubation'
    ]);
    const doses = await linesFor(
      { careLevel: '4232005', ivMedicationCount: 1 },
      { ...NO_FINDINGS, ivDoses: 3 }
    );
    assert.equal(getPath(doses?.service ?? null, 'level'), 'ALS2');
    assert.equal(getPath((await linesFor(bls, null))?.service ?? null, 'level'), 'BLS');
  });
});
