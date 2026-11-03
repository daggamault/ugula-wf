import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type BatchClaim,
  type BillingStores,
  billingModels,
  build837,
  type ClaimCheck,
  type ClaimEvent,
  type ClaimStore,
  createBillingNodes,
  type FeeStore,
  type Patient,
  type PatientStore,
  readX837Claim
} from '@ugula/billing';
import {
  completeCheck,
  type MemoryClaimOptions,
  memoryClaims,
  memoryFees,
  memoryPayers
} from '@ugula/billing/testing';

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
    <ePayment.InsuranceGroup><ePayment.09>BCBS1</ePayment.09><ePayment.10>Blue Plan</ePayment.10><ePayment.11>2611003</ePayment.11><ePayment.17>G7</ePayment.17><ePayment.18>XYZ123</ePayment.18><ePayment.19>Doe</ePayment.19><ePayment.20>John</ePayment.20><ePayment.22>2622005</ePayment.22></ePayment.InsuranceGroup>
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
    duplicate?: boolean;
    known?: Patient[];
    report?: Json;
    places?: Record<string, string>;
    unpriced?: string[];
    modelDown?: boolean;
    claim?: MemoryClaimOptions;
    claimId?: string;
  } = {}
) => {
  const report = { bucket: 'ugula', key: 'imports/t/f.xml.reports/00000.json' };
  const priced: (string | null)[] = [];
  const blue = { id: 'p-blue', name: 'Blue Plan', claimFiling: 'BL' };
  const acme = { id: 'p-acme', name: 'Acme Health Plan', claimFiling: 'CI' };
  const payers = memoryPayers(
    { [blue.name]: blue },
    {
      'Acme Health': [
        { ...blue, similarity: 0.61 },
        { ...acme, similarity: 0.6 }
      ]
    }
  );
  const patients: PatientStore = {
    findCandidates: async () => opts.known ?? [],
    findPatient: async (_, id) => opts.known?.find((p) => p.id === id) ?? null,
    createPatient: async (_, __, p) => ({ id: 'p-new', ...p }),
    updateAddress: async (_, __, id, address) => ({
      ...(opts.known?.find((p) => p.id === id) as Patient),
      ...address
    })
  };
  const schedule = memoryFees((_, code) => (opts.unpriced?.includes(code) ? null : 10_000));
  const fees: FeeStore = {
    ...schedule.store,
    findFees: async (runId, payerId, codes) => {
      priced.push(payerId);
      return schedule.store.findFees(runId, payerId, codes);
    }
  };
  const claims = memoryClaims({
    status: opts.duplicate ? 'needs_review' : 'draft',
    ...opts.claim
  });
  const duplicate = opts.duplicate === true;
  const stores: BillingStores = {
    patients,
    payers: payers.store,
    fees,
    claims: {
      ...claims.store,
      openDraft: async (runId, key, draft) => {
        const opened = await claims.store.openDraft(runId, key, draft);
        return { ...opened, duplicate };
      }
    },
    completer: {
      complete: async (r) => {
        if (opts.modelDown) throw new Error('The model server is down');
        return r.user.startsWith('Report payer:')
          ? { choice: 2 }
          : { medications: [{ medication: 'fentanyl', route: 'IV', doses: 2 }], procedures: [] };
      }
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
    { report, ...(opts.claimId ? { claimId: opts.claimId } : {}) },
    { now }
  );
  const waitFor = async (kind: string, title?: string) => {
    await engine.drain(state, { runId: 'r', now: new Date(Date.now()) });
    if (state.suspension?.kind === 'timer') {
      engine.resume(state, state.suspension.id, null);
      return waitFor(kind, title);
    }
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
    drafts: claims.drafts,
    assigned: claims.patients,
    saved: claims.saved,
    patches: claims.patches,
    closed: claims.closed,
    revisions: claims.revisions,
    current: claims.current,
    fees: schedule.saved,
    priced,
    aliases: payers.aliases
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
        'billing.price-charges',
        'billing.fix-claim',
        'billing.review-patient-match',
        'billing.resolve-patient',
        'billing.resolve-payers',
        'billing.cycle-claim',
        'billing.encounter-to-claim',
        'billing.recover-draft',
        'billing.ingest-nemsis'
      ]
    );
  });

  it('turns a new PCR into a claim: payers learned, narrative considered, held, released, fixed and billed', async () => {
    const world = pcrWorld();
    const payer = await world.waitFor('task', 'Match payer');
    assert.deepEqual(world.drafts, [
      { pcrNumber: 'PCR-1', reportKey: world.report.key, claimId: null }
    ]);
    assert.deepEqual(world.assigned, ['p-new']);
    assert.equal(world.data('queue'), 'billing-payers');
    assert.equal(world.data('subject'), 'PCR-1 · Acme Health');
    assert.deepEqual(world.data('context'), {
      reportedPayer: 'Acme Health',
      memberId: null,
      patient: 'Jane Doe',
      pcrNumber: 'PCR-1',
      notes: []
    });
    assert.deepEqual(world.data('defaults'), { payerId: null });
    assert.deepEqual(world.data('outcomes'), ['link', 'unlisted', 'remove']);
    assert.deepEqual(world.data('fields'), [
      {
        name: 'payerId',
        type: 'string',
        label: 'Directory payer',
        required: ['link'],
        options: [
          {
            value: 'p-acme',
            label: 'Acme Health Plan (Commercial insurance) · 60% similar · suggested'
          },
          { value: 'p-blue', label: 'Blue Plan (Blue Cross/Blue Shield) · 61% similar' }
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
    assert.deepEqual(world.data('context.warnings'), [
      'No disposition or type of service is recorded, so the trip was classified as an emergency transport'
    ]);
    assert.deepEqual(world.data('defaults'), {
      level: 'ALS2',
      emergency: true,
      loadedMiles: 4.25,
      basis: [
        'Three or more IV/IO medications coded',
        'ALS care documented',
        'IV/IO medications coded',
        'IV/IO doses in the narrative'
      ],
      tripType: 'emergency'
    });
    assert.equal(world.data('context.trip.tripType'), 'emergency');

    world.answer(review, 'hold', { level: 'ALS1', note: 'Missing signature' });
    const held = await world.waitFor('task', 'Held PCR');
    assert.equal(world.data('queue'), 'billing-holds');
    assert.equal(world.data('context.note'), 'Missing signature');
    world.answer(held, 'release');
    review = await world.waitFor('task', 'Review PCR');
    assert.equal(world.data('defaults.level'), 'ALS1');
    assert.equal(world.data('defaults.loadedMiles'), 4.25);
    world.answer(review, 'approve', { tripType: 'emergency', level: 'ALS1', loadedMiles: 4.21 });

    const fix = await world.waitFor('task', 'Fix claim data');
    const [claim] = world.saved;
    assert.equal(claim?.level, 'ALS1');
    assert.equal(claim?.tripType, 'emergency');
    assert.deepEqual(
      claim?.coverages.map((c) => [c.payer, c.payerId, c.relationship, c.insuredFirstName]),
      [
        ['Blue Plan', 'p-blue', '19', 'John'],
        ['Acme Health', 'p-acme', '18', null]
      ]
    );
    assert.equal(claim?.totalCents, 53_000);
    assert.deepEqual(
      claim?.lines.map((l) => [l.code, l.units]),
      [
        ['A0427', 1],
        ['A0425', 4.3]
      ]
    );
    assert.deepEqual(claim?.details.destination, {
      name: 'St. Mary',
      addressLine: '1 Hospital Way',
      city: null,
      state: 'IL',
      postalCode: '62702'
    });
    assert.deepEqual(
      (world.data('context.issues') as { field: string }[]).map((i) => i.field),
      ['diagnoses', 'destination', 'originDestination', 'memberId']
    );
    assert.deepEqual(world.data('outcomes'), ['save', 'void', 'backToReview']);
    assert.deepEqual(
      (world.data('fields') as { name: string }[]).map((f) => f.name),
      [
        'diagnoses',
        'destinationName',
        'destinationAddressLine',
        'destinationCity',
        'destinationState',
        'destinationPostalCode',
        'originCode',
        'destinationCode',
        'coverageId',
        'payerId',
        'memberId',
        'relationship',
        'insuredFirstName',
        'insuredLastName',
        'removeCoverage',
        'note'
      ]
    );
    assert.equal(world.data('defaults.coverageId'), 'cov-Acme Health');
    world.answer(fix, 'save', {
      diagnoses: ['R07.9'],
      destinationCity: 'Springfield',
      originCode: 'R',
      destinationCode: 'H',
      coverageId: 'cov-Acme Health',
      memberId: 'A1'
    });

    const start = await world.waitFor('start');
    assert.deepEqual(world.priced, ['p-blue', 'p-blue']);
    assert.equal(world.patches.length, 2);
    assert.deepEqual(world.current()?.details.diagnoses, ['R079']);
    assert.equal(world.current()?.details.originDestination, 'RH');
    assert.equal(world.current()?.totalCents, 53_000);
    assert.deepEqual(world.data('inputs'), { claimId: 'c1' });
    world.engine.resume(world.state, start, { runId: 'cycle-1' });
    const outputs = await world.finish(world.state);
    assert.deepEqual([outputs.claimId, outputs.tripType], ['c1', 'emergency']);
  });

  it('asks for the price of a code without a fee, and reads no narrative when the model is down', async () => {
    const world = pcrWorld({ unpriced: ['A0427'], modelDown: true });
    const payer = await world.waitFor('task', 'Match payer');
    assert.equal(world.data('defaults.payerId'), null);
    assert.deepEqual(world.data('context.notes'), [
      'The language model was unavailable, so no payer was suggested'
    ]);
    world.answer(payer, 'remove');
    const review = await world.waitFor('task', 'Review PCR');
    assert.deepEqual(world.data('context.coverage'), [
      { payer: 'Blue Plan', directory: 'Blue Plan', memberId: 'XYZ123', groupId: 'G7' }
    ]);
    assert.deepEqual(world.data('context.narrative'), { medications: [], procedures: [] });
    assert.ok(
      (world.data('context.warnings') as string[]).includes(
        'The language model was unavailable, so the narrative was not read'
      )
    );
    world.answer(review, 'approve', { tripType: 'emergency', level: 'ALS1' });
    const charge = await world.waitFor('task', 'Set charge');
    assert.deepEqual(world.data('context.codes'), ['A0427 · ALS1, emergency transport']);
    assert.deepEqual(world.data('defaults'), { code: 'A0427' });
    world.answer(charge, 'price', { code: 'A0427', unitPrice: 812.5, saveToSchedule: true });
    await world.waitFor('task', 'Fix claim data');
    assert.deepEqual(world.fees, [[null, 'A0427', 81_250]]);
    assert.equal(world.saved[0]?.lines[0]?.unitCents, 81_250);
  });

  it('treats an already billed PCR as a revision of its claim, never a second claim', async () => {
    const world = pcrWorld({
      duplicate: true,
      claim: { status: 'submitted', previous: { bucket: 'ugula', key: 'old.json' } }
    });
    const revision = await world.waitFor('task', 'Review updated PCR');
    assert.deepEqual(world.revisions, [world.report]);
    assert.equal(world.data('context.claimId'), 'c1');
    assert.equal(world.data('context.canApply'), false);
    assert.equal(world.data('context.trip.pcrNumber'), 'PCR-1');
    assert.deepEqual(world.data('context.changes'), []);
    assert.deepEqual(world.data('outcomes'), ['apply', 'acknowledge', 'void']);
    world.answer(revision, 'apply');
    world.answer(await world.waitFor('task', 'Review updated PCR'), 'acknowledge');
    const outputs = await world.finish(world.state);
    assert.deepEqual(
      [outputs.claimId, world.assigned.length, world.saved.length, world.priced.length],
      ['c1', 0, 0, 0]
    );
  });

  it('works a claim that can still change again from the corrected report, showing what changed', async () => {
    const world = pcrWorld({
      duplicate: true,
      claim: { status: 'void', previous: null }
    });
    const revision = await world.waitFor('task', 'Review updated PCR');
    assert.equal(world.data('context.canApply'), true);
    assert.equal(world.data('context.changes'), null);
    world.answer(revision, 'apply');
    const start = await world.waitFor('start');
    assert.deepEqual(world.data('inputs'), { report: world.report, claimId: 'c1' });
    world.engine.resume(world.state, start, { runId: 'run-2' });
    await world.finish(world.state);

    const restarted = pcrWorld({ claimId: 'c1' });
    await restarted.waitFor('task', 'Match payer');
    assert.deepEqual(restarted.drafts, [
      { pcrNumber: 'PCR-1', reportKey: restarted.report.key, claimId: 'c1' }
    ]);
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
    world.answer(confirm, 'useSelected', { patientId: 'p-jane' });
    world.answer(await world.waitFor('task', 'Match payer'), 'unlisted');
    await world.waitFor('task', 'Review PCR');
    assert.equal(world.data('context.patient.birthDate'), '1980-01-20');
  });

  it('preselects the likeliest candidate and creates a new patient from the report when none fits', async () => {
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
    assert.deepEqual(world.data('defaults'), { patientId: 'p-jane' });
    assert.deepEqual(
      (world.data('fields') as { name: string }[]).map((f) => f.name),
      ['patientId']
    );
    world.answer(confirm, 'createNew');
    world.answer(await world.waitFor('task', 'Match payer'), 'unlisted');
    await world.waitFor('task', 'Review PCR');
    assert.equal(world.data('context.patient.birthDate'), '1980-01-02');
    assert.deepEqual(world.assigned, ['p-new']);
  });

  it('asks for the missing name or birth date before creating the patient', async () => {
    const report = parseDataset(REPORT.replace('<ePatient.17>1980-01-02</ePatient.17>', ''))
      .reports[0];
    const world = pcrWorld({ report: report ?? null });
    const complete = await world.waitFor('task', 'Complete patient details');
    world.answer(complete, 'savePatient', {
      firstName: 'Jane',
      lastName: 'Doe',
      birthDate: '1980-01-02'
    });
    world.answer(await world.waitFor('task', 'Match payer'), 'unlisted');
    await world.waitFor('task', 'Review PCR');
    assert.equal(world.data('context.patient.birthDate'), '1980-01-02');
    assert.deepEqual(world.assigned, ['p-new']);
  });

  it('asks for valid completed details and matches them like any report, asking about likely patients', async () => {
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
    const report = parseDataset(REPORT.replace('<ePatient.17>1980-01-02</ePatient.17>', ''))
      .reports[0];
    const world = pcrWorld({ report: report ?? null, known: [typo] });
    await world.waitFor('task', 'Complete patient details');
    assert.deepEqual(world.data('fields'), [
      { name: 'firstName', type: 'string', label: 'First name', required: ['savePatient'] },
      { name: 'lastName', type: 'string', label: 'Last name', required: ['savePatient'] },
      {
        name: 'birthDate',
        type: 'string',
        label: 'Birth date',
        format: 'date',
        required: ['savePatient']
      }
    ]);
    assert.equal(world.data('defaults.lastName'), 'Doe');
    world.answer(await world.waitFor('task', 'Complete patient details'), 'savePatient', {
      firstName: 'Jane',
      lastName: 'Doe',
      birthDate: '1980-01-02'
    });
    const confirm = await world.waitFor('task', 'Confirm patient');
    assert.equal(world.data('context.reason'), 'Similar patients found');
    assert.equal(world.data('context.report.birthDate'), '1980-01-02');
    world.answer(confirm, 'useSelected', { patientId: 'p-jane' });
    world.answer(await world.waitFor('task', 'Match payer'), 'unlisted');
    await world.waitFor('task', 'Review PCR');
    assert.deepEqual(world.assigned, ['p-jane']);
  });

  it('voids the draft claim of a held PCR without billing it', async () => {
    const world = pcrWorld();
    world.answer(await world.waitFor('task', 'Match payer'), 'unlisted');
    world.answer(await world.waitFor('task', 'Review PCR'), 'hold', { note: 'Duplicate trip' });
    world.answer(await world.waitFor('task', 'Held PCR'), 'void');
    const outputs = await world.finish(world.state);
    assert.deepEqual([outputs.claimId, world.saved.length, world.closed], ['c1', 0, ['void']]);
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

  const cycleWorld = (
    opts: {
      start?: string;
      events?: ClaimEvent[];
      check?: ClaimCheck;
      coverages?: { id: string; payer: string }[];
      agency?: boolean;
    } = {}
  ) => {
    const DAY = 86_400_000;
    const start = Date.parse(opts.start ?? '2026-01-01T00:00:00.000Z');
    let clock = new Date(start);
    const at = (days: number) => {
      clock = new Date(start + days * DAY);
    };
    const events: ClaimEvent[] = [...(opts.events ?? [])];
    const closed: string[] = [];
    const statuses: string[] = [];
    const memory = memoryClaims({ check: opts.check ?? completeCheck(['Medicare']) });
    const event = (
      kind: ClaimEvent['kind'],
      coverageId: string | null,
      paidCents = 0,
      payerClaimNumber: string | null = null
    ): ClaimEvent => ({
      kind,
      coverageId,
      paidCents,
      adjustedCents: 0,
      payerClaimNumber,
      paidOn: null,
      adjustments: [],
      at: clock.toISOString()
    });
    const claims: ClaimStore = {
      ...memory.store,
      setStatus: async (_, __, ___, status) => {
        if (statuses.at(-1) !== status) statuses.push(status);
        return 'set';
      },
      patchClaim: async (runId, claimId, key, patch) => {
        await memory.store.patchClaim(runId, claimId, key, patch);
        events.push(event('edited', null));
      },
      statementData: async () => ({
        agency:
          opts.agency === false
            ? null
            : {
                name: 'Agency',
                addressLine: null,
                city: null,
                state: null,
                postalCode: null,
                phone: '2175550100',
                timeZone: 'America/Chicago'
              },
        patient: {
          name: 'Jane Doe',
          addressLine: '1 Main St',
          city: 'Springfield',
          state: 'IL',
          postalCode: '62701'
        },
        reference: 'PCR-1',
        serviceDate: null,
        lines: [],
        totalCents: 100_000,
        payments: [],
        balanceCents: 100_000
      }),
      saveStatement: async (_, __, ___, { pdf, number, count }) => {
        assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), '%PDF-');
        assert.ok(number >= 1 && number <= count && count === 3);
        events.push(event('statement', null));
      },
      ledger: async () => ({
        totalCents: 100_000,
        coverages: opts.coverages ?? [{ id: 'cov-Medicare', payer: 'Medicare' }],
        events,
        signalsSeen: events.length,
        reference: 'PCR-1 · Jane Doe'
      }),
      recordEvent: async (_, __, ___, e) => {
        events.push(event(e.kind, e.coverageId, 0, e.payerClaimNumber));
      },
      closeClaim: async (_, __, ___, status) => {
        closed.push(status);
      }
    };
    const engine = createEngine({
      nodes: [
        ...createStdNodes({ fetch }),
        ...createBillingNodes({
          claims,
          patients: only(),
          payers: memoryPayers({ Medicare: { id: 'p-mcr', name: 'Medicare', claimFiling: 'MB' } })
            .store,
          fees: memoryFees(() => 10_000).store,
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
    const waitFor = async (kind: string, title?: string) => {
      await engine.drain(state, { runId: 'r', now: clock });
      assert.equal(state.suspension?.kind, kind, state.fault?.error.message ?? '');
      if (title) assert.equal(getPath(state.suspension?.data ?? null, 'title'), title);
      return state.suspension?.id ?? '';
    };
    const answer = (wait: string, outcome: string, values: Record<string, Json> = {}) =>
      engine.resume(state, wait, { outcome, values });
    const data = (path: string) => getPath(state.suspension?.data ?? null, path);
    return {
      engine,
      state,
      at,
      events,
      event,
      closed,
      statuses,
      memory,
      waitFor,
      answer,
      data,
      kinds: () => events.map((e) => e.kind),
      push: (kind: ClaimEvent['kind'], coverageId: string | null, paidCents = 0) =>
        events.push(event(kind, coverageId, paidCents))
    };
  };

  it('cycles a claim through its payers, follow-ups, patient review and spaced statements until paid', async () => {
    const w = cycleWorld();
    const review = await w.waitFor('task', 'Review claim');
    assert.equal(w.data('queue'), 'billing-review');
    assert.deepEqual(w.data('outcomes'), ['approve', 'fixData', 'skipPayer', 'void']);
    assert.deepEqual(w.data('context.issues'), []);
    assert.equal(w.data('context.claim.details.serviceDate'), '2025-12-30');
    w.answer(review, 'approve');
    let wait = await w.waitFor('signal');
    assert.deepEqual(w.kinds(), ['approved']);
    assert.deepEqual(w.state.suspension?.data, {
      name: 'claim',
      key: 'c1',
      until: '2026-01-04T00:00:00.000Z',
      after: 1
    });
    w.push('submitted', 'cov-Medicare');
    w.engine.resume(w.state, wait, { payload: null });
    wait = await w.waitFor('signal');
    assert.equal(getPath(w.state.suspension?.data ?? null, 'until'), '2026-01-31T00:00:00.000Z');

    w.at(30);
    w.engine.resume(w.state, wait, { timedOut: true });
    let followUp = await w.waitFor('task', 'Follow up on claim');
    assert.equal(w.data('subject'), 'PCR-1 · Jane Doe · Medicare');
    assert.deepEqual(
      [w.data('context.claimId'), w.data('context.coverageId'), w.data('context.balanceCents')],
      ['c1', 'cov-Medicare', 100_000]
    );
    w.answer(followUp, 'resubmit', { payerClaimNumber: 'MCR-9' });
    w.answer(await w.waitFor('task', 'Review claim'), 'approve');
    wait = await w.waitFor('signal');
    assert.deepEqual(w.kinds(), ['approved', 'submitted', 'resubmit_queued', 'approved']);
    assert.equal(w.events[2]?.payerClaimNumber, 'MCR-9');
    w.push('resubmitted', 'cov-Medicare');
    w.engine.resume(w.state, wait, { payload: null });
    wait = await w.waitFor('signal');

    w.at(60);
    w.engine.resume(w.state, wait, { timedOut: true });
    followUp = await w.waitFor('task', 'Follow up on claim');
    w.answer(followUp, 'nextPayer');
    const patientReview = await w.waitFor('task', 'Review claim');
    assert.equal(w.data('context.coverageId'), null);
    w.answer(patientReview, 'approve');
    wait = await w.waitFor('signal');
    assert.deepEqual(w.kinds().slice(-3), ['payer_skipped', 'approved', 'statement']);

    w.at(61);
    w.push('response', null, 5_000);
    w.engine.resume(w.state, wait, { payload: null });
    wait = await w.waitFor('signal');
    assert.equal(getPath(w.state.suspension?.data ?? null, 'until'), '2026-04-01T00:00:00.000Z');

    w.at(90);
    w.engine.resume(w.state, wait, { timedOut: true });
    wait = await w.waitFor('signal');
    assert.equal(w.kinds().filter((k) => k === 'statement').length, 2);

    w.push('response', null, 95_000);
    w.engine.resume(w.state, wait, { payload: null });
    await w.engine.drain(w.state, { runId: 'r', now: new Date('2026-04-01T00:00:00.000Z') });
    assert.equal(w.state.status, 'completed', w.state.fault?.error.message ?? '');
    assert.deepEqual(w.closed, ['paid']);
    assert.deepEqual(w.statuses, [
      'needs_review',
      'ready',
      'submitted',
      'follow_up',
      'needs_review',
      'ready',
      'submitted',
      'follow_up',
      'needs_review',
      'patient_balance'
    ]);
  });

  it('asks for a claim that sat ready too long to be submitted, and logs one submitted elsewhere', async () => {
    const w = cycleWorld();
    w.answer(await w.waitFor('task', 'Review claim'), 'approve');
    const wait = await w.waitFor('signal');
    w.at(3);
    w.engine.resume(w.state, wait, { timedOut: true });
    const submit = await w.waitFor('task', 'Submit claim');
    assert.deepEqual(w.data('outcomes'), ['submitted', 'fixData', 'skipPayer']);
    w.answer(submit, 'submitted');
    await w.waitFor('signal');
    assert.deepEqual(w.kinds(), ['approved', 'submitted']);
    assert.equal(w.statuses.at(-1), 'submitted');
  });

  it('fixes what blocks a claim before review, and reviews it again after an edit', async () => {
    const check = completeCheck(['Medicare']);
    const w = cycleWorld({ check: { ...check, details: { ...check.details, serviceDate: null } } });
    const fix = await w.waitFor('task', 'Fix claim data');
    assert.equal(w.data('subject'), 'PCR-1 · Jane Doe · Medicare');
    assert.deepEqual(
      (w.data('fields') as { name: string }[]).map((f) => f.name),
      ['serviceDate', 'note']
    );
    w.answer(fix, 'save', { serviceDate: '2025-12-29' });
    const review = await w.waitFor('task', 'Review claim');
    assert.equal(w.memory.current()?.details.serviceDate, '2025-12-29');
    w.answer(review, 'fixData');
    const all = await w.waitFor('task', 'Fix claim data');
    assert.ok((w.data('fields') as unknown[]).length > 20);
    w.answer(all, 'save', {
      serviceDate: '2025-12-29',
      diagnoses: ['R079'],
      level: 'BLS',
      emergency: false
    });
    await w.waitFor('task', 'Review claim');
    assert.equal(w.memory.current()?.lines[0]?.code, 'A0428');
    assert.deepEqual(w.kinds(), ['edited', 'edited', 'edited']);
  });

  it('confirms the payers of a claim without any, or bills the patient', async () => {
    const w = cycleWorld({ check: completeCheck([]), coverages: [] });
    const confirm = await w.waitFor('task', 'Confirm payers');
    assert.deepEqual(w.data('outcomes'), ['save', 'selfPay']);
    assert.deepEqual(
      (w.data('fields') as { name: string; options?: unknown[] }[]).map((f) => [
        f.name,
        f.options?.length ?? 0
      ]),
      [
        ['payerId', 1],
        ['memberId', 0],
        ['relationship', 9],
        ['insuredFirstName', 0],
        ['insuredLastName', 0]
      ]
    );
    w.answer(confirm, 'selfPay');
    await w.waitFor('signal');
    assert.deepEqual(w.kinds(), ['approved', 'statement']);
  });

  it('asks for a billing profile before sending a statement instead of faulting', async () => {
    const w = cycleWorld({
      check: completeCheck([]),
      coverages: [],
      agency: false
    });
    w.push('approved', null);
    const needed = await w.waitFor('task', 'Billing profile needed');
    assert.deepEqual(w.data('outcomes'), ['continue']);
    w.answer(needed, 'continue');
    await w.waitFor('task', 'Billing profile needed');
  });

  it('asks a biller to reconcile a payer response that leaves a balance', async () => {
    const w = cycleWorld({ start: '2026-01-11T00:00:00.000Z' });
    w.push('approved', 'cov-Medicare');
    w.push('submitted', 'cov-Medicare');
    w.events.push({ ...w.event('response', 'cov-Medicare', 60_000), payerClaimNumber: 'ICN-1' });
    const reconcile = await w.waitFor('task', 'Reconcile payment');
    assert.equal(w.data('queue'), 'billing-reconcile');
    assert.equal(w.data('context.balanceCents'), 40_000);
    assert.deepEqual(w.data('outcomes'), ['continue', 'writeOff', 'resubmitCorrected']);
    w.answer(reconcile, 'resubmitCorrected');
    const review = await w.waitFor('task', 'Review claim');
    assert.equal(w.data('context.coverageId'), 'cov-Medicare');
    assert.equal(w.kinds().at(-1), 'resubmit_queued');
    w.answer(review, 'void');
    await w.engine.drain(w.state, { runId: 'r', now: new Date('2026-01-11T00:00:00.000Z') });
    assert.equal(w.state.status, 'completed', w.state.fault?.error.message ?? '');
    assert.deepEqual(w.closed, ['void']);
  });

  it('suggests the level of service with every reason that applied', async () => {
    assert.deepEqual(await serviceFor(PCR), {
      level: 'ALS2',
      emergency: true,
      loadedMiles: 4.25,
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
      { code: 'A0425', units: 12.37, unitCents: null, totalCents: null }
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
      reason: 'Patient treated and transported by this unit'
    });
    assert.equal(
      (await tripOf(wrap('<eResponse><eResponse.05>2205001</eResponse.05></eResponse>'))).reason,
      'Emergency response'
    );

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
    assert.deepEqual(await suggest('emergency'), [true, 4.25]);
    assert.deepEqual(await suggest('scheduled'), [false, 4.25]);
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
      groupId: 'G7',
      relationship: '2622005',
      insuredFirstName: 'John',
      insuredLastName: 'Doe'
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
          groupId: null,
          relationship: null,
          insuredFirstName: null,
          insuredLastName: null
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
    const medicare = {
      name: 'Medicare',
      payerId: 'DEMOMCR',
      claimFiling: 'MB',
      memberId: '1EG4TE5MK73',
      groupId: null,
      relationship: '18',
      insuredFirstName: null,
      insuredLastName: null
    } as const;
    const submission: BatchClaim = {
      claimId: 'c-1',
      payerClaimNumber: null,
      payer: medicare,
      priorPayers: [],
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
        { code: 'A0425', units: 7.4, unitCents: 1_250, totalCents: 9_250 }
      ]
    };
    const map = async (claim: BatchClaim) =>
      readX837Claim(
        (await evaluate('billing.map-837p', { claim: claim as unknown as Json }, ['x837'])).x837
      );
    const mapped = await map(submission);
    assert.deepEqual(mapped.lines[1], {
      code: 'A0425',
      modifiers: ['RH'],
      chargeCents: 9_250,
      units: 7.4,
      serviceDate: '2026-10-01'
    });
    assert.deepEqual(mapped.conditionCodes, ['09', '06']);
    assert.deepEqual(
      [mapped.frequency, mapped.payerClaimNumber, mapped.otherPayers],
      ['1', null, []]
    );
    assert.deepEqual(mapped.subscriber, {
      relationship: '18',
      lastName: 'Doe',
      firstName: 'Jose',
      memberId: '1EG4TE5MK73',
      groupId: null
    });
    const submitter = {
      organizationName: 'Metro EMS',
      npi: '1234567893',
      taxId: '123456789',
      addressLine: '1 Main St',
      city: 'Springfield',
      state: 'IL',
      postalCode: '627011234',
      phone: '2175550100',
      submitterId: 'SUB01',
      receiverId: 'RCV01',
      receiverName: null,
      production: false
    };
    const file = build837(submitter, [mapped], { controlNumber: 1, createdAt: now });
    assert.ok(file.includes('SV1*HC:A0425:RH*92.5*UN*7.4***1~'));
    assert.ok(file.includes('CLM*c-1*942.5***41:B:1*Y*A*Y*Y~'));
    assert.ok(file.includes('SBR*P*18*******MB~'));
    const scheduled = await map({ ...submission, emergency: false });
    assert.deepEqual(scheduled.conditionCodes, ['09']);
    const noTransport = await map({
      ...submission,
      details: { ...submission.details, originDestination: null },
      loadedMiles: null,
      lines: [{ code: 'A0998', units: 1, unitCents: 25_000, totalCents: 25_000 }]
    });
    assert.deepEqual(
      [noTransport.lines[0]?.modifiers, noTransport.loadedMiles, noTransport.transportReason],
      [['GY'], null, null]
    );
    const secondary = await map({
      ...submission,
      payerClaimNumber: 'BL-77',
      payer: {
        ...medicare,
        name: 'Blue Plan',
        payerId: 'DEMOBCBS',
        claimFiling: 'BL',
        memberId: 'XYZ123',
        relationship: '19',
        insuredFirstName: 'John',
        insuredLastName: 'Doe'
      },
      priorPayers: [
        {
          ...medicare,
          paidCents: 60_000,
          adjustedCents: 20_000,
          paidOn: '2026-10-20',
          adjustments: [
            { group: 'CO', reason: '45', cents: 20_000 },
            { group: 'PR', reason: '1', cents: 20_000 }
          ]
        }
      ]
    });
    assert.deepEqual([secondary.frequency, secondary.payerClaimNumber], ['7', 'BL-77']);
    assert.deepEqual(
      [
        secondary.subscriber.relationship,
        secondary.subscriber.firstName,
        secondary.patient.firstName
      ],
      ['19', 'John', 'Jose']
    );
    assert.deepEqual(secondary.otherPayers, [
      {
        name: 'Medicare',
        payerId: 'DEMOMCR',
        claimFiling: 'MB',
        memberId: '1EG4TE5MK73',
        groupId: null,
        relationship: '18',
        lastName: 'Doe',
        firstName: 'Jose',
        paidCents: 60_000,
        adjustedCents: 20_000,
        paidOn: '2026-10-20',
        adjustments: [
          { group: 'CO', reason: '45', cents: 20_000 },
          { group: 'PR', reason: '1', cents: 20_000 }
        ]
      }
    ]);
    const cob = build837(submitter, [secondary], { controlNumber: 2, createdAt: now });
    assert.ok(cob.includes('SBR*S********BL~'));
    assert.ok(cob.includes('PAT*19~'));
    assert.ok(cob.includes('REF*F8*BL-77~'));
    assert.ok(cob.includes('AMT*D*600~'));
    assert.ok(cob.includes('CAS*CO*45*200~') && cob.includes('CAS*PR*1*200~'));
  });

  it('asks on the draft claim before voiding a report that needs no claim, and can still claim it', async () => {
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
      claimId: 'c1'
    });
    assert.deepEqual([skipped.drafts.length, skipped.closed], [1, ['void']]);
    const claimed = pcrWorld({ report: cancelled ?? null });
    await claimed.waitFor('task', 'Confirm no claim');
    assert.deepEqual(
      (claimed.data('fields.0.options') as { value: string }[]).map((o) => o.value),
      ['emergency', 'scheduled', 'treatNoTransport', 'refusal']
    );
    claimed.answer(await claimed.waitFor('task', 'Confirm no claim'), 'claim', {
      tripType: 'scheduled'
    });
    claimed.answer(await claimed.waitFor('task', 'Match payer'), 'remove');
    await claimed.waitFor('task', 'Review PCR');
    assert.equal(claimed.data('context.trip.tripType'), 'scheduled');
    assert.equal(claimed.data('defaults.tripType'), 'scheduled');
    assert.equal(claimed.data('defaults.emergency'), false);
  });

  it('bills a refusal as treatment without transport', async () => {
    const refusal = parseDataset(
      REPORT.replace(
        '<eDisposition.32>4232005</eDisposition.32>',
        '<eDisposition.32>4232005</eDisposition.32><eDisposition.12>4212025</eDisposition.12>'
      )
    ).reports[0];
    const world = pcrWorld({ report: refusal ?? null });
    world.answer(await world.waitFor('task', 'Match payer'), 'remove');
    world.answer(await world.waitFor('task', 'Review PCR'), 'approve', {
      tripType: 'refusal',
      level: 'ALS1'
    });
    const fix = await world.waitFor('task', 'Fix claim data');
    assert.deepEqual(
      (world.data('context.issues') as { field: string }[]).map((i) => i.field),
      ['diagnoses']
    );
    world.answer(fix, 'save', { diagnoses: ['R69'] });
    await world.waitFor('start');
    assert.deepEqual(
      world.saved[0]?.lines.map((l) => l.code),
      ['A0998']
    );
  });

  it('keeps an incomplete claim in draft and asks for what it is missing', async () => {
    const undated = parseDataset(REPORT.replace(/<eTimes>.*<\/eTimes>/, '')).reports[0];
    const world = pcrWorld({ report: undated ?? null });
    world.answer(await world.waitFor('task', 'Match payer'), 'remove');
    world.answer(await world.waitFor('task', 'Review PCR'), 'approve', {
      tripType: 'emergency',
      level: 'ALS1'
    });
    await world.waitFor('task', 'Fix claim data');
    assert.deepEqual(world.data('context.issues.0'), {
      level: 'blocking',
      field: 'serviceDate',
      message: 'The date of service is missing',
      coverageId: null
    });
    assert.ok((world.data('fields') as { name: string }[]).some((f) => f.name === 'serviceDate'));
    world.answer(await world.waitFor('task', 'Fix claim data'), 'backToReview');
    world.answer(await world.waitFor('task', 'Review PCR'), 'hold', { note: 'Ask the crew' });
    world.answer(await world.waitFor('task', 'Held PCR'), 'void');
    assert.deepEqual((await world.finish(world.state)).claimId, 'c1');
    assert.deepEqual([world.saved.length, world.closed], [1, ['void']]);
  });
  it('asks what to do with a draft claim whose workflow stopped, restarting or voiding it', async () => {
    const memory = memoryClaims();
    const engine = createEngine({
      nodes: [
        ...createStdNodes({ fetch }),
        ...createBillingNodes({
          claims: memory.store,
          patients: only(),
          payers: only(),
          fees: only(),
          completer: only()
        }),
        ...modelNodes
      ],
      graphs: graphSource()
    });
    const report = { bucket: 'ugula', key: 'r.json' };
    const run = async (outcome: string) => {
      const state = engine.start(
        { type: 'billing.recover-draft', version: 1 },
        { claimId: 'c1', report, reason: 'The run was cancelled' },
        { now }
      );
      await engine.drain(state, { runId: 'r', now });
      assert.equal(getPath(state.suspension?.data ?? null, 'title'), 'Draft claim has no workflow');
      assert.deepEqual(getPath(state.suspension?.data ?? null, 'context'), {
        claimId: 'c1',
        reason: 'The run was cancelled'
      });
      engine.resume(state, state.suspension?.id ?? '', { outcome, values: {} });
      await engine.drain(state, { runId: 'r', now });
      return state;
    };
    const restarted = await run('restart');
    assert.equal(restarted.suspension?.kind, 'start');
    assert.deepEqual(getPath(restarted.suspension?.data ?? null, 'inputs'), {
      report,
      claimId: 'c1'
    });
    assert.equal((await run('void')).status, 'completed');
    assert.deepEqual(memory.closed, ['void']);
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
