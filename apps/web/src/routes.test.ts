import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ReactElement } from 'react';
import { ClaimPage } from './features/claims/claim-page.tsx';
import { ClaimsPage } from './features/claims/claims-page.tsx';
import { PatientClaims } from './features/claims/patient-claims.tsx';
import { FacilitiesPage } from './features/facilities/facilities-page.tsx';
import { FacilityPage } from './features/facilities/facility-page.tsx';
import { FeePage } from './features/fees/fee-page.tsx';
import { FeesPage } from './features/fees/fees-page.tsx';
import { ImportPage } from './features/imports/import-page.tsx';
import { ImportsPage } from './features/imports/imports-page.tsx';
import { PatientPage } from './features/patients/patient-page.tsx';
import { PatientsPage } from './features/patients/patients-page.tsx';
import { PayerPage } from './features/payers/payer-page.tsx';
import { PayersPage } from './features/payers/payers-page.tsx';
import { RolePage } from './features/roles/role-page.tsx';
import { RolesPage } from './features/roles/roles-page.tsx';
import { RunsPage } from './features/runs/runs-page.tsx';
import { StartRunPage } from './features/runs/start-run-page.tsx';
import { SettingsPage } from './features/settings/settings-page.tsx';
import { TaskPage } from './features/tasks/task-page.tsx';
import { TasksPage } from './features/tasks/tasks-page.tsx';
import { InvitePage } from './features/users/invite-page.tsx';
import { UserPage } from './features/users/user-page.tsx';
import { UsersPage } from './features/users/users-page.tsx';
import { TablePage } from './features/workflows/table-page.tsx';
import { TablesPage } from './features/workflows/tables-page.tsx';
import { WorkflowsPage } from './features/workflows/workflows-page.tsx';
import { type AppClients, type RouteContext, resolveRoute } from './routes.tsx';
import { idleLive, testNodes } from './shared/testing.ts';

const clients = {
  workflows: { name: 'workflows' },
  runs: { name: 'runs' },
  tasks: { name: 'tasks' },
  imports: { name: 'imports' },
  fees: { name: 'fees' },
  claims: { name: 'claims' },
  patients: { name: 'patients' },
  payers: { name: 'payers' },
  facilities: { name: 'facilities' },
  users: { name: 'users' },
  roles: { name: 'roles' },
  settings: { name: 'settings' },
  codes: { name: 'codes' }
} as unknown as AppClients;

const ctx: RouteContext = {
  ...clients,
  nodes: testNodes,
  live: idleLive,
  email: 'dev@example.com'
};

type Routed = ReactElement<Record<string, unknown>> & { key: string | null };

const resolve = (path: string, search = '') =>
  resolveRoute(path, new URLSearchParams(search), ctx) as Routed;

const props = (path: string, search = '') => resolve(path, search).props;

const isLazy = (el: Routed) =>
  (el.type as unknown as { $$typeof: symbol }).$$typeof === Symbol.for('react.lazy');

describe('resolveRoute', () => {
  it('opens the page each path names', () => {
    const pages: [string, unknown][] = [
      ['/workflows', WorkflowsPage],
      ['/tables', TablesPage],
      ['/tables/t1', TablePage],
      ['/runs', RunsPage],
      ['/runs/new', StartRunPage],
      ['/tasks', TasksPage],
      ['/tasks/t1', TaskPage],
      ['/imports', ImportsPage],
      ['/imports/i1', ImportPage],
      ['/claims', ClaimsPage],
      ['/claims/c1', ClaimPage],
      ['/patients', PatientsPage],
      ['/patients/p1', PatientPage],
      ['/fees', FeesPage],
      ['/fees/new', FeePage],
      ['/fees/f1', FeePage],
      ['/payers', PayersPage],
      ['/payers/new', PayerPage],
      ['/payers/p1', PayerPage],
      ['/facilities', FacilitiesPage],
      ['/facilities/new', FacilityPage],
      ['/facilities/x1', FacilityPage],
      ['/users', UsersPage],
      ['/users/invitations', UsersPage],
      ['/users/invite', InvitePage],
      ['/users/u1', UserPage],
      ['/roles', RolesPage],
      ['/roles/new', RolePage],
      ['/roles/r1', RolePage],
      ['/settings', SettingsPage]
    ];
    for (const [path, page] of pages) assert.equal(resolve(path).type, page, path);
  });

  it('loads the workflow editor and the run page lazily', () => {
    assert.equal(isLazy(resolve('/workflows/g1')), true);
    assert.equal(isLazy(resolve('/runs/r1')), true);
  });

  it('opens nothing for unknown paths', () => {
    assert.equal(resolveRoute('/nope', new URLSearchParams(), ctx), null);
    assert.equal(resolveRoute('/claims/c1/extra', new URLSearchParams(), ctx), null);
    assert.equal(resolveRoute('/', new URLSearchParams(), ctx), null);
  });

  it('hands each page its feature client and live updates', () => {
    assert.equal(props('/claims').client, clients.claims);
    assert.equal(props('/claims').live, idleLive);
    assert.equal(props('/fees/f1').client, clients.fees);
    assert.equal(props('/facilities').client, clients.facilities);
    assert.equal(props('/tables').client, clients.workflows);
    assert.equal(props('/tasks/t1').codes, clients.codes);
    assert.equal(props('/workflows/g1').nodes, testNodes);
  });

  it('gives the task list the signed-in email', () => {
    assert.equal(props('/tasks').me, 'dev@example.com');
  });

  it('passes ids from the path', () => {
    assert.equal(props('/tables/t1').tableId, 't1');
    assert.equal(props('/workflows/g%201').graphId, 'g 1');
    assert.equal(props('/runs/r1').runId, 'r1');
    assert.equal(props('/imports/i1').importId, 'i1');
    assert.equal(props('/claims/c1').claimId, 'c1');
    assert.equal(props('/patients/p1').patientId, 'p1');
    assert.equal(props('/fees/f1').feeId, 'f1');
    assert.equal(props('/payers/p1').payerId, 'p1');
    assert.equal(props('/facilities/x1').facilityId, 'x1');
    assert.equal(props('/users/u1').userId, 'u1');
    assert.equal(props('/roles/r1').roleId, 'r1');
    assert.equal(props('/tasks/t1').taskId, 't1');
  });

  it('opens new records without an id', () => {
    assert.equal(props('/fees/new').feeId, null);
    assert.equal(props('/payers/new').payerId, null);
    assert.equal(props('/facilities/new').facilityId, null);
    assert.equal(props('/roles/new').roleId, null);
  });

  it('remounts record pages when the id changes', () => {
    assert.equal(resolve('/fees/f1').key, 'f1');
    assert.equal(resolve('/payers/p1').key, 'p1');
    assert.equal(resolve('/facilities/x1').key, 'x1');
    assert.equal(resolve('/users/u1').key, 'u1');
    assert.equal(resolve('/roles/r1').key, 'r1');
    assert.equal(resolve('/tasks/t1').key, 't1');
  });

  it('shows the patient claims on the patient page', () => {
    const claims = props('/patients/p1').claims as Routed;
    assert.equal(claims.type, PatientClaims);
    assert.deepEqual(claims.props, { client: clients.claims, live: idleLive, patientId: 'p1' });
  });

  it('opens the users page on the users or invitations tab', () => {
    assert.equal(props('/users').tab, 'users');
    assert.equal(props('/users/invitations').tab, 'invitations');
  });

  it('starts a run for the graph in the URL', () => {
    assert.equal(props('/runs/new', 'graph=g1').graphId, 'g1');
    assert.equal(props('/runs/new').graphId, '');
  });

  it('opens a run at the nested step in the URL', () => {
    assert.deepEqual(props('/runs/r1', 'at=n1/n2').at, ['n1', 'n2']);
    assert.deepEqual(props('/runs/r1').at, []);
  });

  it('reads positive whole versions and drops the rest', () => {
    assert.equal(props('/workflows/g1', 'version=3').version, 3);
    assert.equal(props('/tables/t1', 'version=2').version, 2);
    for (const version of ['0', '-1', '1.5', 'x', '']) {
      assert.equal(props('/workflows/g1', `version=${version}`).version, null, version);
    }
    assert.equal(props('/tables/t1').version, null);
  });

  it('follows the editor trail from the URL', () => {
    assert.deepEqual(props('/workflows/g1', 'trail=g0:2,bad').trail, [
      { graphId: 'g0', version: 2 }
    ]);
  });

  it('reads the claim tab and falls back to the overview', () => {
    assert.equal(props('/claims/c1', 'tab=data').tab, 'data');
    assert.equal(props('/claims/c1', 'tab=bogus').tab, 'overview');
  });

  it('reads the claim and patient searches from the URL', () => {
    assert.deepEqual(props('/claims', 'lastName=doe&number=7').search, {
      firstName: '',
      lastName: 'doe',
      birthDate: '',
      number: '7'
    });
    assert.deepEqual(props('/patients', 'firstName=jo').search, {
      lastName: '',
      firstName: 'jo',
      birthDate: '',
      number: ''
    });
  });

  it('returns to the list unless the URL names an allowed back link', () => {
    const backs: [string, string, string][] = [
      ['/claims/c1', 'back=/patients/p1', '/patients/p1'],
      ['/claims/c1', 'back=/claims?lastName=doe', '/claims?lastName=doe'],
      ['/claims/c1', 'back=https://evil.test', '/claims'],
      ['/claims/c1', 'back=//evil.test', '/claims'],
      ['/claims/c1', '', '/claims'],
      ['/patients/p1', 'back=/patients?lastName=doe', '/patients?lastName=doe'],
      ['/patients/p1', 'back=/claims', '/patients'],
      ['/imports/i1', 'back=/imports?page=2', '/imports?page=2'],
      ['/fees/new', 'back=/fees?q=a', '/fees?q=a'],
      ['/payers/p1', 'back=/payersx', '/payers'],
      ['/facilities/new', 'back=/facilities?q=b', '/facilities?q=b'],
      ['/users/invite', 'back=/users/invitations', '/users'],
      ['/users/u1', 'back=/users?q=a', '/users?q=a'],
      ['/roles/r1', 'back=/roles?q=bill', '/roles?q=bill']
    ];
    for (const [path, search, back] of backs) {
      assert.equal(props(path, search).back, back, `${path}?${search}`);
    }
  });

  it('lets a task return to the tasks, runs or imports it came from', () => {
    assert.equal(props('/tasks/t1').back, null);
    assert.equal(props('/tasks/t1', 'back=/tasks?queue=billing').back, '/tasks?queue=billing');
    assert.equal(props('/tasks/t1', 'back=/claims?lastName=doe').back, '/tasks');
    assert.equal(props('/tasks/t1', 'back=/runs/r1').back, '/runs/r1');
    assert.equal(props('/tasks/t1', 'back=/imports/i1').back, '/imports/i1');
    assert.equal(props('/tasks/t1', 'back=/patients/p1').back, '/tasks');
    assert.equal(props('/tasks/t1', 'back=https://evil.test').back, '/tasks');
  });
});
