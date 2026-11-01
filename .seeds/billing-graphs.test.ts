import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type BillingStores,
  type BlobRef,
  billingModels,
  build837,
  type ClaimEvent,
  type ClaimStore,
  createBillingNodes,
  type FeeStore,
  type NewClaim,
  type Patient,
  type PatientStore,
  type PayerStore,
  readX837Claim
} from '@ugula/billing';
import {
  combineSources,
  createEngine,
  createModelNodes,
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
import {
  createNemsisNodes,
  nemsisModels,
  parseDataset,
  type ReportStore,
  toPcr
} from '@ugula/nemsis';
import { billingGraphs } from './billing-graphs.ts';
import { assertValidGraphs, graphNodes } from './seed.ts';

const now = new Date('2026-10-01T00:00:00.000Z');

const REPORT = `<EMSDataSet xmlns="http://www.nemsis.org"><Header><PatientCareReport>
  <eRecord><eRecord.01>PCR-1</eRecord.01></eRecord>
  <eTimes><eTimes.01>2026-09-30T23:40:00-05:00</eTimes.01></eTimes>
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

const PCR = toPcr(REPORT_DATA);

const pcrOf = (xml: string) => toPcr(parseDataset(xml).reports[0] ?? null);

const evaluate = async (type: string, inputs: Record<string, Json>, outputs: string[]) => {
  const main: GraphDef = {
    signature: {
      execIn: ['exec'],
      execOut: [],
      inputs: [],
      outputs: outputs.map((name) => ({ name, type: 'any' }))
    },
    variables: [],
    nodes: [
      { id: 'entry', type: ENTRY_TYPE, version: 1 },
      {
        id: 'node',
        type,
        version: 1,
        inputs: Object.fromEntries(Object.entries(inputs).map(([k, value]) => [k, { value }]))
      },
      { id: 'ret', type: RETURN_TYPE, version: 1 }
    ],
    edges: [
      { from: 'entry', fromPin: 'exec', to: 'ret', toPin: 'exec' },
      ...outputs.map((name) => ({ from: 'node', fromPin: name, to: 'ret', toPin: name }))
    ]
  };
  const engine = engineFor(main);
  const state = engine.start({ type: 'test.main', version: 1 }, {}, { now });
  await engine.drain(state, { runId: 'r', now });
  assert.equal(state.status, 'completed', state.fault?.error.message ?? '');
  return state.result?.outputs ?? {};
};

const NO_FINDINGS = { medications: [], procedures: [], ivDoses: 0 };

const serviceFor = async (pcr: Json, findings: Json = NO_FINDINGS) =>
  (await evaluate('billing.level-of-service', { pcr, findings }, ['service'])).service as Record<
    string,
    Json
  >;

const linesFor = async (tripType: string, service: Json) =>
  (await evaluate('billing.map-charges', { tripType, service }, ['lines'])).lines;

const tripOf = async (xml: string) =>
  evaluate('billing.classify-trip', { pcr: pcrOf(xml) }, ['tripType', 'reason']);

const wrap = (body: string) =>
  `<EMSDataSet xmlns="http://www.nemsis.org"><Header><PatientCareReport>${body}</PatientCareReport></Header></EMSDataSet>`;

const modelNodes = createModelNodes([...nemsisModels, ...billingModels]);

const only = <T extends object>(impl: Partial<T> = {}) =>
  new Proxy(impl, {
    get: (target, name) =>
      Object.hasOwn(target, name)
        ? target[name as keyof typeof target]
        : () => {
            throw new Error(`${String(name)} should not be called`);
          }
  }) as T;

const SPRINGFIELD: Record<string, string> = { '2395220': 'Springfield' };

const pcrWorld = (
  opts: {
    billed?: string;
    duplicate?: boolean;
    known?: Patient[];
    report?: Json;
    places?: Record<string, string>;
  } = {}
) => {
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
      ...createNemsisNodes(
        only<ReportStore>({
          getJson: async () => opts.report ?? REPORT_DATA,
          findPlaces: async (codes) =>
            Object.fromEntries(
              codes.flatMap((c) => {
                const name = (opts.places ?? SPRINGFIELD)[c];
                return name ? [[c, name]] : [];
              })
            )
        })
      ),
      ...createBillingNodes(stores),
      ...modelNodes
    ],
    graphs: graphSource()
  });
  const state = engine.start(
    { type: 'billing.encounter-to-claim', version: 1 },
    { report },
    { now }
  );
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
        'billing.classify-trip',
        'billing.loaded-miles',
        'billing.level-of-service',
        'billing.trip-emergency',
        'billing.trip-scheduled',
        'billing.trip-treat-no-transport',
        'billing.trip-refusal',
        'billing.suggest-service',
        'billing.map-charges',
        'billing.demographics-from-pcr',
        'billing.coverages-from-pcr',
        'billing.trip-details',
        'billing.map-claim',
        'billing.map-837p',
        'billing.resolve-patient',
        'billing.resolve-payers',
        'billing.cycle-claim',
        'billing.encounter-to-claim',
        'billing.ingest-nemsis'
      ]
    );
  });

  it('turns a new PCR into a claim: payers learned, narrative considered, held, released and billed', async () => {
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
        'Three or more IV/IO medications coded',
        'ALS care documented',
        'IV/IO medications coded',
        'IV/IO doses in the narrative'
      ]
    });
    assert.equal(world.data('context.trip.tripType'), 'emergency');

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
    assert.deepEqual([outputs.claimId, outputs.tripType], ['c1', 'emergency']);
    assert.equal(claim?.totalCents, 53_000);
    assert.deepEqual(
      claim?.lines.map((l) => [l.code, l.units]),
      [
        ['A0427', 1],
        ['A0425', 4.3]
      ]
    );
    assert.deepEqual(claim?.details, {
      serviceDate: '2026-09-30',
      pickup: {
        name: null,
        addressLine: '9 Elm St',
        city: 'Springfield',
        state: 'IL',
        postalCode: '62701'
      },
      destination: {
        name: 'St. Mary',
        addressLine: '1 Hospital Way',
        city: null,
        state: 'IL',
        postalCode: '62702'
      },
      diagnoses: [],
      originDestination: null
    });
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
        address: '1 Main St, Springfield, 62704',
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

  it('spawns one Encounter to Claim run per report and completes without waiting for them', async () => {
    const file = { bucket: 'ugula', key: 'imports/t/f.xml' };
    const engine = createEngine({
      nodes: [
        ...createStdNodes({ fetch }),
        ...createNemsisNodes({
          getText: async () => REPORT.replace('</Header>', '<PatientCareReport/></Header>'),
          getJson: async () => null,
          putJson: async (_, key) => ({ bucket: 'ugula', key, size: 1, contentType: 'json' }),
          recordReports: async () => undefined,
          findPlaces: async () => ({})
        }),
        ...createBillingNodes(null),
        ...modelNodes
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
        }),
        ...modelNodes
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

  it('suggests the level of service with every reason that applied', async () => {
    assert.deepEqual(await serviceFor(PCR), {
      level: 'ALS2',
      emergency: true,
      loadedMiles: 4.3,
      basis: [
        'Three or more IV/IO medications coded',
        'ALS care documented',
        'IV/IO medications coded'
      ]
    });
    const bls = pcrOf(
      wrap('<eDisposition><eDisposition.32>4232001</eDisposition.32></eDisposition>')
    );
    assert.deepEqual(await serviceFor(bls), {
      level: 'BLS',
      emergency: false,
      loadedMiles: null,
      basis: ['BLS care documented']
    });
    const narrated = await serviceFor(bls, { ...NO_FINDINGS, ivDoses: 1 });
    assert.deepEqual(
      [narrated.level, narrated.basis],
      ['ALS1', ['IV/IO doses in the narrative', 'BLS care documented']]
    );
    const intubated = await serviceFor(bls, { ...NO_FINDINGS, procedures: ['intubation'] });
    assert.equal(intubated.level, 'ALS2');
    const crew = pcrOf(wrap('<ePayment><ePayment.50>2650003</ePayment.50></ePayment>'));
    assert.deepEqual(
      [(await serviceFor(crew)).level, (await serviceFor(crew)).emergency],
      ['ALS1', true]
    );
    const critical = pcrOf(
      wrap('<eDisposition><eDisposition.32>4232009</eDisposition.32></eDisposition>')
    );
    assert.equal((await serviceFor(critical, null)).level, 'SCT');
  });

  it('maps a confirmed service to HCPCS lines by trip type', async () => {
    const service = { level: 'ALS1', emergency: true, loadedMiles: 12.37, basis: [] };
    assert.deepEqual(await linesFor('emergency', service), [
      { code: 'A0427', units: 1, unitCents: null, totalCents: null },
      { code: 'A0425', units: 12.4, unitCents: null, totalCents: null }
    ]);
    const codes = async (tripType: string, s: Record<string, Json>) =>
      ((await linesFor(tripType, { ...service, ...s })) as { code: string }[]).map((l) => l.code);
    assert.deepEqual(await codes('scheduled', { emergency: false, loadedMiles: null }), ['A0426']);
    assert.deepEqual(await codes('emergency', { level: 'BLS' }), ['A0429', 'A0425']);
    assert.deepEqual(await codes('scheduled', { level: 'BLS', emergency: false }), [
      'A0428',
      'A0425'
    ]);
    assert.deepEqual(await codes('emergency', { level: 'ALS2' }), ['A0433', 'A0425']);
    assert.deepEqual(await codes('emergency', { level: 'SCT', loadedMiles: 0 }), ['A0434']);
    assert.deepEqual(await codes('treatNoTransport', {}), ['A0998']);
    assert.deepEqual(await codes('refusal', {}), ['A0998']);
  });

  it('classifies trips from NEMSIS 3.4 and 3.5 dispositions and the type of service', async () => {
    const disposition = (xml: string) => wrap(`<eDisposition>${xml}</eDisposition>`);
    assert.deepEqual(await tripOf(disposition('<eDisposition.12>4212033</eDisposition.12>')), {
      tripType: 'emergency',
      reason: 'Emergency transport'
    });
    assert.equal(
      (await tripOf(disposition('<eDisposition.12>4212007</eDisposition.12>'))).tripType,
      'noClaim'
    );
    assert.equal(
      (await tripOf(disposition('<eDisposition.12>4212025</eDisposition.12>'))).tripType,
      'refusal'
    );
    assert.equal(
      (await tripOf(disposition('<eDisposition.12>4212029</eDisposition.12>'))).tripType,
      'treatNoTransport'
    );
    assert.equal(
      (
        await tripOf(
          disposition(
            '<eDisposition.28>4228007</eDisposition.28><eDisposition.30>4230009</eDisposition.30>'
          )
        )
      ).tripType,
      'refusal'
    );
    assert.equal(
      (await tripOf(disposition('<eDisposition.27>4227005</eDisposition.27>'))).tripType,
      'noClaim'
    );
    assert.equal(
      (await tripOf(disposition('<eDisposition.12>4212041</eDisposition.12>'))).tripType,
      'noClaim'
    );
    assert.equal(
      (await tripOf(disposition('<eDisposition.30>4230011</eDisposition.30>'))).tripType,
      'noClaim'
    );
    assert.equal(
      (await tripOf(disposition('<eDisposition.12>4212019</eDisposition.12>'))).tripType,
      'treatNoTransport'
    );
    assert.deepEqual(
      await tripOf(wrap('<eResponse><eResponse.05>2205005</eResponse.05></eResponse>')),
      { tripType: 'scheduled', reason: 'Scheduled or interfacility transport' }
    );
  });

  it('suggests the service for each trip type', async () => {
    const suggest = async (tripType: string) => {
      const main: GraphDef = {
        signature: {
          execIn: ['exec'],
          execOut: [],
          inputs: [],
          outputs: [{ name: 'service', type: 'any' }]
        },
        variables: [],
        nodes: [
          { id: 'entry', type: ENTRY_TYPE, version: 1 },
          {
            id: 'suggest',
            type: 'billing.suggest-service',
            version: 1,
            inputs: { tripType: { value: tripType }, pcr: { value: PCR } }
          },
          { id: 'ret', type: RETURN_TYPE, version: 1 }
        ],
        edges: [
          { from: 'entry', fromPin: 'exec', to: 'suggest', toPin: 'exec' },
          { from: 'suggest', fromPin: 'then', to: 'ret', toPin: 'exec' },
          { from: 'suggest', fromPin: 'service', to: 'ret', toPin: 'service' }
        ]
      };
      const engine = engineFor(main);
      const state = engine.start({ type: 'test.main', version: 1 }, {}, { now });
      await engine.drain(state, { runId: 'r', now });
      assert.equal(state.status, 'completed', state.fault?.error.message ?? '');
      const service = state.result?.outputs.service as Record<string, Json>;
      return [service.emergency, service.loadedMiles];
    };
    assert.deepEqual(await suggest('emergency'), [true, 4.3]);
    assert.deepEqual(await suggest('scheduled'), [false, 4.3]);
    assert.deepEqual(await suggest('treatNoTransport'), [true, null]);
    assert.deepEqual(await suggest('refusal'), [true, null]);
  });

  it('maps report demographics, coverages and trip details', async () => {
    assert.deepEqual(
      (await evaluate('billing.demographics-from-pcr', { pcr: PCR }, ['demographics']))
        .demographics,
      {
        firstName: 'Jane',
        lastName: 'Doe',
        birthDate: '1980-01-02',
        gender: '9919003',
        addressLine: '1 Main St',
        city: '2395220',
        state: '17',
        postalCode: '62704'
      }
    );
    const { coverages } = await evaluate('billing.coverages-from-pcr', { pcr: PCR }, ['coverages']);
    assert.deepEqual((coverages as Json[])[1], {
      payer: 'Blue Plan',
      payerCode: 'BCBS1',
      priority: '2611003',
      memberId: 'XYZ123',
      groupId: 'G7'
    });
    const medicare = pcrOf(wrap('<ePayment><ePayment.01>2601005</ePayment.01></ePayment>'));
    assert.deepEqual(
      (await evaluate('billing.coverages-from-pcr', { pcr: medicare }, ['coverages'])).coverages,
      [
        {
          payer: 'Medicare',
          payerId: null,
          directoryName: null,
          payerCode: null,
          priority: '2611003',
          memberId: null,
          groupId: null
        }
      ]
    );
    const trip = pcrOf(
      wrap(`<eTimes><eTimes.01>2026-10-01T08:15:00-05:00</eTimes.01></eTimes>
        <eScene><eScene.09>Y92.009</eScene.09></eScene>
        <eSituation><eSituation.11>R07.9</eSituation.11><eSituation.12>I10</eSituation.12></eSituation>
        <eDisposition><eDisposition.21>4221003</eDisposition.21></eDisposition>`)
    );
    const details = await evaluate('billing.trip-details', { pcr: trip }, [
      'serviceDate',
      'diagnoses',
      'originDestination'
    ]);
    assert.deepEqual(details, {
      serviceDate: '2026-10-01',
      diagnoses: ['R07.9', 'I10'],
      originDestination: 'RH'
    });
    const transfer = pcrOf(wrap('<eResponse><eResponse.05>2205005</eResponse.05></eResponse>'));
    assert.equal(
      (await evaluate('billing.trip-details', { pcr: transfer }, ['originDestination']))
        .originDestination,
      'H'
    );
  });

  it('maps a claim on its way to a payer onto an 837P claim', async () => {
    const place = {
      addressLine: '9 Oak Ave',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62702'
    };
    const submission = {
      claimId: 'c-1',
      priorPayers: [],
      payer: { name: 'Medicare', payerId: 'DEMOMCR', claimFiling: 'MB' },
      memberId: '1EG4TE5MK73',
      groupId: null,
      patient: { firstName: 'Jose', lastName: 'Doe', birthDate: '1950-02-03', sex: 'M', ...place },
      details: {
        serviceDate: '2026-10-01',
        pickup: { name: null, ...place },
        destination: { name: 'Mercy Hospital', ...place },
        diagnoses: ['R079'],
        originDestination: 'RH'
      },
      emergency: true,
      loadedMiles: 7.33,
      lines: [
        { code: 'A0427', units: 1, unitCents: 85_000, totalCents: 85_000 },
        { code: 'A0425', units: 7.33, unitCents: 1_250, totalCents: 9_163 }
      ]
    };
    const { x837 } = await evaluate('billing.map-837p', { claim: submission }, ['x837']);
    const mapped = readX837Claim(x837);
    assert.deepEqual(mapped.lines[1], {
      code: 'A0425',
      modifiers: ['RH'],
      chargeCents: 9_163,
      units: 7.33,
      serviceDate: '2026-10-01'
    });
    assert.deepEqual(mapped.conditionCodes, ['09', '06']);
    assert.deepEqual([mapped.payer.responsibility, mapped.subscriber.relationship], ['P', '18']);
    const file = build837(
      {
        organizationName: 'Metro EMS',
        npi: '1234567893',
        taxId: '123456789',
        addressLine: '1 Main St',
        city: 'Springfield',
        state: 'IL',
        postalCode: '62701',
        phone: '2175550100',
        submitterId: 'SUB01',
        receiverId: 'RCV01',
        receiverName: null,
        production: false
      },
      [mapped],
      { controlNumber: 1, createdAt: now }
    );
    assert.ok(file.includes('SV1*HC:A0425:RH*91.63*UN*7.4***1~'));
    assert.ok(file.includes('CLM*c-1*941.63***41:B:1*Y*A*Y*Y~'));
    const scheduled = await evaluate(
      'billing.map-837p',
      { claim: { ...submission, emergency: false } },
      ['x837']
    );
    assert.deepEqual(getPath(scheduled.x837 ?? null, 'conditionCodes'), ['09']);
    const noTransport = await evaluate(
      'billing.map-837p',
      {
        claim: {
          ...submission,
          details: { ...submission.details, originDestination: 'RX' },
          lines: [{ code: 'A0998', units: 1, unitCents: 25_000, totalCents: 25_000 }]
        }
      },
      ['x837']
    );
    assert.deepEqual(getPath(noTransport.x837 ?? null, 'lines.0.modifiers'), ['RX', 'GY']);
  });

  it('asks before skipping a report that needs no claim, and can still claim it', async () => {
    const cancelled = parseDataset(
      REPORT.replace(
        '<eDisposition.32>4232005</eDisposition.32>',
        '<eDisposition.32>4232005</eDisposition.32><eDisposition.12>4212007</eDisposition.12>'
      )
    ).reports[0];
    const skipped = pcrWorld({ report: cancelled ?? null });
    skipped.answer(await skipped.waitFor('task', 'Confirm no claim'), 'skip');
    assert.deepEqual(await skipped.finish(skipped.state), {
      tripType: 'noClaim',
      patient: null,
      claimId: null
    });
    const claimed = pcrWorld({ report: cancelled ?? null });
    claimed.answer(await claimed.waitFor('task', 'Confirm no claim'), 'claim');
    await claimed.waitFor('task', 'Match payer');
  });

  it('bills a refusal as treatment without transport', async () => {
    const refusal = parseDataset(
      REPORT.replace(
        '<eDisposition.32>4232005</eDisposition.32>',
        '<eDisposition.32>4232005</eDisposition.32><eDisposition.12>4212025</eDisposition.12>'
      )
    ).reports[0];
    const world = pcrWorld({ report: refusal ?? null });
    world.answer(await world.waitFor('task', 'Match payer'), 'unlisted');
    world.answer(await world.waitFor('task', 'Review PCR'), 'approve', { loadedMiles: null });
    await world.waitFor('start');
    assert.deepEqual(
      world.opened[0]?.lines.map((l) => l.code),
      ['A0998']
    );
  });

  it('sends an incomplete claim back for attention instead of saving it', async () => {
    const undated = parseDataset(REPORT.replace(/<eTimes>.*<\/eTimes>/, '')).reports[0];
    const world = pcrWorld({ report: undated ?? null });
    world.answer(await world.waitFor('task', 'Match payer'), 'unlisted');
    world.answer(await world.waitFor('task', 'Review PCR'), 'approve', { level: 'ALS1' });
    await world.waitFor('task', 'Claim needs attention');
    assert.deepEqual(world.data('context.issues'), ['A claim needs a date of service']);
    world.answer(await world.waitFor('task', 'Claim needs attention'), 'void');
    assert.deepEqual((await world.finish(world.state)).claimId, null);
    assert.equal(world.opened.length, 0);
  });
});

describe('task context', () => {
  it('names GNIS city codes, and leaves codes it cannot name out of addresses', async () => {
    const named = pcrWorld();
    named.answer(await named.waitFor('task', 'Match payer'), 'unlisted');
    await named.waitFor('task', 'Review PCR');
    assert.equal(named.data('context.patient.address'), '1 Main St, Springfield, 62704');
    assert.equal(named.data('context.trip.pickup'), '9 Elm St, Springfield, 62701');
    const unknown = pcrWorld({ places: {} });
    unknown.answer(await unknown.waitFor('task', 'Match payer'), 'unlisted');
    await unknown.waitFor('task', 'Review PCR');
    assert.equal(unknown.data('context.patient.address'), '1 Main St, 62704');
  });
});
