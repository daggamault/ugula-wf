import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import type { Permission } from '@ugula/access';
import type { ClaimIssue } from '@ugula/billing';
import type { LiveEvent } from '@ugula/live';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type Access, AccessProvider } from '../../shared/access.tsx';
import type { ClaimDetail } from '../../shared/claims/claim-detail.ts';
import { claimDetail as claim } from '../../shared/claims/testing.ts';
import type { Live } from '../../shared/live.ts';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import type { Page } from '../../shared/url-state.ts';
import type { Resource } from '../../shared/use-resource.ts';
import { ClaimPage, type ClaimTab, ClaimView } from './claim-page.tsx';
import type { ClaimEvent, ClaimProgress, ClaimsClient } from './client.ts';

const medicare = { id: 'cov-m', payer: 'Medicare' };

const loaded = (items: ClaimEvent[]): Resource<Page<ClaimEvent>> => ({
  data: { items, total: items.length, page: 1, pageSize: 25 },
  error: undefined,
  loading: false,
  reload: () => undefined
});

const events: ClaimEvent[] = [
  {
    id: 'e1',
    kind: 'response',
    coverage_id: null,
    payer: null,
    paid_cents: 5_000,
    adjusted_cents: 0,
    paid_on: '2026-10-01',
    check_number: 'CHK-77',
    payer_claim_number: null,
    note: 'card',
    created_at: '2026-10-02T00:00:00Z',
    has_document: false
  },
  {
    id: 'e2',
    kind: 'statement',
    coverage_id: null,
    payer: null,
    paid_cents: 0,
    adjusted_cents: 0,
    paid_on: null,
    check_number: null,
    payer_claim_number: null,
    note: 'Patient statement 1 of 3',
    created_at: '2026-10-03T00:00:00Z',
    has_document: true
  }
];

const renderView = (
  over: Partial<ClaimDetail> = {},
  progress: ClaimProgress | null = null,
  tab: ClaimTab = 'overview',
  issues: readonly ClaimIssue[] = []
) =>
  renderToStaticMarkup(
    createElement(ClaimView, {
      claim: { ...claim, ...over },
      issues,
      codes: {},
      tab,
      files: [],
      history: loaded(events),
      progress,
      onDownloadEligibility: async () => undefined,
      documentUrl: (eventId: string) => `/docs/${eventId}`
    })
  );

describe('ClaimView', () => {
  it('shows the classification and the claim check issues of an open claim', () => {
    const issues: ClaimIssue[] = [
      {
        code: 'member-id-missing',
        severity: 'blocking',
        field: 'memberId',
        message: 'Member ID missing',
        coverageId: 'cov-b'
      }
    ];
    const html = renderView({}, null, 'overview', issues);
    assert.ok(html.includes('Emergency Transport'));
    assert.ok(
      html.includes('Must Be Fixed') && html.includes('Member ID: </span>Member ID missing')
    );
    assert.ok(!renderView({ status: 'paid' }, null, 'overview', issues).includes('Must Be Fixed'));
  });

  it('leaves out the encounter number and says when there is no PCR number', () => {
    const html = renderView({ encounter_number: null, pcr_number: null, patient_number: null });
    assert.ok(html.includes('Claim 20261001-0012'));
    assert.ok(!html.includes('Encounter 2') && !html.includes('Patient 2'));
    assert.ok(html.includes('No PCR number'));
  });

  it('shows lines, ordered payers, documents and history without a single form', () => {
    const html = renderView(
      {},
      {
        step: 'await',
        coverage: { id: 'cov-b', payer: 'Blue Plan' },
        waitMs: 1,
        balanceCents: 1
      }
    );
    assert.ok(html.includes('Waiting on Blue Plan'));
    assert.ok(html.includes('Doe, Jane'));
    assert.ok(html.includes('Claim 20261001-0012') && html.includes('Patient 20260915-0003'));
    assert.ok(html.includes('Encounter 20261001-0007') && html.includes('PCR PCR-1001'));
    assert.ok(html.includes('12.4 miles loaded'));
    assert.ok(html.includes('A0427'));
    assert.ok(html.includes('1. </span>Medicare') && html.includes('2. </span>Blue Plan'));
    assert.ok(html.includes('Member ID 1EG4'));
    assert.match(html, /History<span[^>]*tabular-nums[^>]*>2<\/span>/);
    assert.equal(html.match(/Not in Payer Directory/g)?.length, 1);
    assert.ok(
      html.includes('Responsible Facility') && html.includes('None: the payers and the patient')
    );
    assert.ok(
      html.includes('No documents are on this claim yet.') && html.includes('Download 270')
    );
    assert.ok(
      html.includes('href="/claims/c1?tab=data"') && html.includes('href="/claims/c1?tab=history"')
    );
    for (const tab of ['overview', 'data', 'history'] as const) {
      const page = renderView({}, null, tab);
      if (tab !== 'history') assert.ok(!/<form|<input|<select|<textarea|<fieldset/.test(page), tab);
      assert.ok(
        !/Post Payment|Save |Upload Document|Chase Document|Check Eligibility/.test(page),
        tab
      );
    }
    const history = renderView({}, null, 'history');
    assert.ok(history.includes('$50.00 paid') && history.includes('Check or EFT CHK-77'));
    assert.ok(history.includes('href="/docs/e2"'));
    assert.equal(history.match(/View PDF/g)?.length, 1);
  });

  it('shows the claim data read only on its tab', () => {
    const data = renderView({}, null, 'data');
    assert.ok(data.includes('Date of Service') && data.includes('R07.9') && data.includes('I10'));
    assert.ok(data.includes('1 Main St, Springfield, IL 62704') && data.includes('St. Mary'));
    assert.ok(data.includes('Correct Claim Data task'));
  });

  it('links to the cycle run when it has stopped and points at Start Task to restart it', () => {
    const html = renderView({ cycle_status: 'failed' });
    assert.ok(html.includes('href="/runs/cycle-1"'));
    assert.ok(html.includes('Restart it from Start Task.'));
    assert.ok(!html.includes('Restart Payer Cycle'));
    assert.ok(!renderView({ cycle_status: 'faulted' }).includes('Restart it'));
  });

  it('shows each task the claim is waiting on', () => {
    const task = {
      id: 't1',
      title: 'Confirm patient',
      subject: 'PCR-1',
      queue: 'billing-patients',
      kind: 'task',
      assignee_id: null,
      assignee_email: null,
      due_at: null,
      created_at: '2026-10-01T00:00:00Z'
    } as const;
    const html = renderView({
      status: 'draft',
      patient_id: null,
      patient_number: null,
      first_name: null,
      last_name: null,
      birth_date: null,
      tasks: [task, { ...task, id: 't2', kind: 'fault', title: 'Stuck at Price' }]
    });
    assert.ok(html.includes('Patient not matched yet'));
    assert.ok(!html.includes('href="/patients/'));
    assert.ok(html.includes('Confirm patient') && html.includes('Patient Matching · Unassigned'));
    assert.ok(html.includes('href="/tasks/t1?back=%2Fclaims%2Fc1"'));
    assert.equal(html.match(/>Work Task</g)?.length, 2);
  });
});

describe('ClaimView submission', () => {
  it('has no buttons to create or mark the 837P file, which the cycle files once approved', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimView, {
        claim,
        issues: [],
        codes: {},
        files: [],
        history: loaded([]),
        progress: { step: 'submit', coverage: medicare, balanceCents: 1 },
        onDownloadEligibility: async () => undefined,
        documentUrl: () => '',
        submission: { fileUrl: (id) => `/files/${id}`, encounterUrl: (id) => `/encounters/${id}` }
      })
    );
    assert.ok(html.includes('Approved. Creating its 837P file for Medicare'));
    assert.ok(!html.includes('Create 837P File') && !html.includes('Mark Submitted'));
    assert.ok(html.includes('href="/patients/p1"'));
  });
});

const access: Access = {
  agencyId: 'a1',
  agencyName: 'North',
  organizationId: 'o1',
  organizationName: 'Acme',
  userId: 'u1',
  isOrganizationAdmin: false,
  permissions: ['claims:update']
};

const foundClaim = (over: Partial<ClaimDetail> = {}) => ({
  claim: { ...claim, ...over },
  files: [],
  payerFiles: [],
  documents: [],
  progress: null,
  issues: [],
  codes: {},
  billing: null
});

const fakeClaims = (over: Partial<ClaimsClient> = {}) => {
  const calls: string[] = [];
  const client: ClaimsClient = {
    list: () => new Promise(() => undefined),
    find: async (id) => {
      calls.push(`find ${id}`);
      return foundClaim();
    },
    events: async (id, page) => {
      calls.push(`events ${id} ${page}`);
      return { items: events, total: events.length, page: 1, pageSize: 25 };
    },
    documentUrl: (claimId, eventId) => `/docs/${claimId}/${eventId}`,
    claimDocumentUrl: (claimId, documentId) => `/documents/${claimId}/${documentId}`,
    restartCycle: async (id) => {
      calls.push(`restart ${id}`);
      return { runId: 'cycle-2' };
    },
    startTask: async (id, key) => {
      calls.push(`start ${id} ${key}`);
      return { runId: 'r1' };
    },
    runTask: async (runId) => {
      calls.push(`runTask ${runId}`);
      return 't9';
    },
    eligibilityRequest: async (id) => {
      calls.push(`270 ${id}`);
      return { name: 'eligibility.x12', file: 'ISA*00~', payers: ['Medicare'] };
    },
    checkEligibility: async (id) => {
      calls.push(`check ${id}`);
      return { runId: 'r2' };
    },
    fileUrl: (batchId) => `/files/${batchId}`,
    encounterUrl: (reportId) => `/encounters/${reportId}`,
    ...over
  };
  return { client, calls };
};

const renderPage = (
  client: ClaimsClient,
  {
    permissions = ['claims:update'],
    live = idleLive,
    tab = 'overview',
    back = '/claims'
  }: { permissions?: Permission[]; live?: Live; tab?: ClaimTab; back?: string } = {}
) => {
  const toasts: ToastInput[] = [];
  render(
    createElement(AccessProvider, {
      access: { ...access, permissions },
      children: createElement(
        ToastProvider,
        { onNotify: (t) => toasts.push(t) },
        createElement(ClaimPage, { client, live, me: 'me@example.com', claimId: 'c1', tab, back })
      )
    })
  );
  return toasts;
};

const shown = () => screen.findByRole('heading', { name: 'Claim 20261001-0012' });

const chooseTask = async (name: RegExp) => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Start Task' }));
  await user.click(screen.getByRole('menuitem', { name }));
};

const startTaskButton = () =>
  screen.getByRole('button', { name: 'Start Task' }) as HTMLButtonElement;

const later = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('ClaimPage', () => {
  it('shows a spinner until the claim loads, then the claim', async () => {
    const answer = later<ReturnType<typeof foundClaim>>();
    const { client, calls } = fakeClaims({ find: () => answer.promise });
    renderPage(client);
    assert.ok(screen.getByRole('status', { name: 'Loading' }));
    answer.resolve(foundClaim());
    await shown();
    assert.ok(!screen.queryByRole('status', { name: 'Loading' }));
    assert.ok(screen.getByText('Doe, Jane'));
    assert.deepEqual(calls, ['events c1 page=1&pageSize=25&sort=when&dir=desc']);
  });

  it('says why the claim could not load', async () => {
    const { client } = fakeClaims({
      find: async () => {
        throw new Error('Claim not found');
      }
    });
    renderPage(client);
    assert.ok(await screen.findByRole('heading', { name: 'Something Went Wrong' }));
    assert.ok(screen.getByText('Claim not found'));
  });

  it('starts the chosen claim task and opens it once its run has opened it', async () => {
    const { client, calls } = fakeClaims();
    renderPage(client, { back: '/claims?lastName=doe' });
    await shown();
    await chooseTask(/^Post Payment/);
    await waitFor(() => assert.equal(window.location.pathname, '/tasks/t9'));
    assert.equal(
      new URLSearchParams(window.location.search).get('back'),
      '/claims/c1?back=%2Fclaims%3FlastName%3Ddoe'
    );
    assert.deepEqual(
      calls.filter((c) => !c.startsWith('find') && !c.startsWith('events')),
      ['start c1 billing.post-payment', 'runTask r1']
    );
  });

  it('keeps Start Task busy while a task starts and says why it could not start', async () => {
    const started = later<{ runId: string }>();
    const { client } = fakeClaims({
      startTask: () => started.promise,
      runTask: async () => {
        throw new Error('The claim is locked by another task');
      }
    });
    renderPage(client);
    await shown();
    await chooseTask(/^Correct Claim Data/);
    assert.equal(startTaskButton().disabled, true);
    assert.equal(startTaskButton().getAttribute('aria-busy'), 'true');
    started.resolve({ runId: 'r1' });
    assert.equal(
      (await screen.findByRole('alert')).textContent,
      'The claim is locked by another task'
    );
    assert.equal(startTaskButton().disabled, false);
    assert.equal(window.location.pathname, '/');
  });

  it('asks every payer about eligibility again, confirms it and reloads the claim', async () => {
    const { client, calls } = fakeClaims();
    const toasts = renderPage(client);
    await shown();
    await chooseTask(/^Check Eligibility/);
    await waitFor(() => assert.equal(toasts.length, 1));
    assert.deepEqual(toasts, [
      {
        title: 'Eligibility check sent to the clearinghouse',
        description: 'Claim 20261001-0012 · Doe, Jane'
      }
    ]);
    assert.ok(calls.includes('check c1'));
    await waitFor(() => assert.equal(calls.filter((c) => c === 'find c1').length, 2));
  });

  it('restarts a payer cycle that stopped', async () => {
    const { client, calls } = fakeClaims({
      find: async () => foundClaim({ cycle_status: 'failed' })
    });
    const toasts = renderPage(client);
    await shown();
    await chooseTask(/^Restart Payer Cycle/);
    await waitFor(() =>
      assert.deepEqual(
        toasts.map((t) => t.title),
        ['Payer cycle restarted']
      )
    );
    assert.ok(calls.includes('restart c1'));
  });

  it('will not restart a payer cycle that is still running, and says why', async () => {
    const { client, calls } = fakeClaims();
    const toasts = renderPage(client);
    await shown();
    await chooseTask(/^Restart Payer Cycle/);
    const item = screen.getByRole('menuitem', { name: /^Restart Payer Cycle/ });
    assert.equal(item.getAttribute('aria-disabled'), 'true');
    assert.match(item.textContent ?? '', /The payer cycle has not stopped\./);
    assert.ok(!calls.includes('restart c1'));
    assert.deepEqual(toasts, []);
  });

  it('shows why an action failed instead of confirming it', async () => {
    const { client } = fakeClaims({
      checkEligibility: async () => {
        throw new Error('The clearinghouse connection is paused');
      }
    });
    const toasts = renderPage(client);
    await shown();
    await chooseTask(/^Check Eligibility/);
    assert.equal(
      (await screen.findByRole('alert')).textContent,
      'The clearinghouse connection is paused'
    );
    assert.deepEqual(toasts, []);
  });

  it('offers no Start Task to someone who cannot update claims', async () => {
    const { client } = fakeClaims();
    renderPage(client, { permissions: ['claims:read'] });
    await shown();
    assert.ok(!screen.queryByRole('button', { name: 'Start Task' }));
  });

  it('downloads the 270 eligibility request for the claim', async (t: TestContext) => {
    const files: Blob[] = [];
    t.mock.method(URL, 'createObjectURL', (blob: Blob) => {
      files.push(blob);
      return 'blob:270';
    });
    t.mock.method(URL, 'revokeObjectURL', () => undefined);
    t.mock.method(HTMLAnchorElement.prototype, 'click', () => undefined);
    const { client, calls } = fakeClaims();
    const toasts = renderPage(client);
    await shown();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Download 270' }));
    await waitFor(() =>
      assert.deepEqual(
        toasts.map((x) => x.title),
        ['Eligibility request (270) downloaded']
      )
    );
    assert.ok(calls.includes('270 c1'));
    assert.equal(files.length, 1);
    assert.equal(await files[0]?.text(), 'ISA*00~');
    assert.equal(files[0]?.type, 'application/edi-x12');
  });

  it('reloads when the claim, its payer cycle or one of its tasks changes, and not otherwise', async () => {
    const listeners: ((e: LiveEvent | null) => void)[] = [];
    const live: Live = {
      ...idleLive,
      subscribe: (listener) => {
        listeners.push(listener);
        return () => undefined;
      }
    };
    const task = {
      id: 't1',
      title: 'Confirm patient',
      subject: 'PCR-1',
      queue: 'billing-patients',
      kind: 'task',
      assignee_id: null,
      assignee_email: null,
      due_at: null,
      created_at: '2026-10-01T00:00:00Z'
    } as const;
    let finds = 0;
    const { client } = fakeClaims({
      find: async () => {
        finds += 1;
        return foundClaim({ tasks: [task] });
      }
    });
    renderPage(client, { live });
    await shown();
    const emit = (e: LiveEvent) => {
      for (const listener of listeners) listener(e);
    };
    emit({ kind: 'claim', id: 'c2' });
    emit({ kind: 'task', id: 't2', runId: null });
    emit({ kind: 'run', id: 'other-run', status: 'running', parentId: null });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(finds, 1);
    emit({ kind: 'run', id: 'cycle-1', status: 'completed', parentId: null });
    await waitFor(() => assert.equal(finds, 2));
    emit({ kind: 'task', id: 't1', runId: null });
    await waitFor(() => assert.equal(finds, 3));
    emit({ kind: 'claim', id: 'c1' });
    await waitFor(() => assert.equal(finds, 4));
  });

  it('pages and sorts the history as the URL asks', async () => {
    window.history.replaceState(
      null,
      '',
      '/claims/c1?tab=history&historySort=amount&historyPage=2'
    );
    const { client, calls } = fakeClaims();
    renderPage(client, { tab: 'history' });
    await shown();
    assert.ok(calls.includes('events c1 page=2&pageSize=25&sort=amount&dir=desc'));
    assert.ok(await screen.findByText('$50.00 paid'));
    assert.equal(
      screen.getByRole('link', { name: 'View PDF' }).getAttribute('href'),
      '/docs/c1/e2'
    );
  });
});
