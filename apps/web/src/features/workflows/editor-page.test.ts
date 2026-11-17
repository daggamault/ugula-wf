import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef, type Issue } from '@ugula/graph';
import { createElement } from 'react';
import { createCatalog } from '../../shared/graph/catalog.ts';
import { idleLive, testNodes } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import type { GraphComparison, GraphDetail, GraphScope, WorkflowsClient } from './client.ts';
import { customizedNodes, EditorPage, EditorView, lockedReason, pinHint } from './editor-page.tsx';
import type { TrailStep } from './trail.ts';

const source: GraphDef = {
  signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
  variables: [{ name: 'lines', type: 'number', default: 0 }],
  nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1 }],
  edges: []
};

const detail = (
  scope: GraphScope,
  published: boolean,
  links: { overridden_by?: string; overrides?: string } = {},
  patch: Partial<GraphDetail['graph']> = {}
): GraphDetail => ({
  graph: {
    id: 'g1',
    scope,
    key: 'acme.flow',
    name: 'Flow',
    kind: 'workflow',
    role: 'workflow',
    description: '',
    overridden_by: links.overridden_by ?? null,
    overrides: links.overrides ?? null,
    is_stale: false,
    canEdit: scope !== 'system',
    canOverride: scope === 'system',
    effectiveId: links.overridden_by ?? 'g1',
    effectiveScope: links.overridden_by ? 'agency' : scope,
    ...patch
  },
  versions: [
    {
      id: 'v2',
      version: 2,
      published_at: published ? '2026-01-01' : null,
      created_at: '2026-01-01',
      base_version: null,
      base_graph_id: null
    },
    {
      id: 'v1',
      version: 1,
      published_at: '2026-01-01',
      created_at: '2026-01-01',
      base_version: null,
      base_graph_id: null
    }
  ]
});

type Call = [string, ...unknown[]];

const fakeClient = (over: Partial<WorkflowsClient> = {}) => {
  const calls: Call[] = [];
  const client = {
    saveDraft: async (id: string, def: GraphDef) => {
      calls.push(['saveDraft', id, def]);
      return { version: 2, issues: [] };
    },
    publish: async (id: string) => {
      calls.push(['publish', id]);
      return { version: 2 };
    },
    override: async (id: string) => {
      calls.push(['override', id]);
      return { id: 'g5' };
    },
    remove: async (id: string) => {
      calls.push(['remove', id]);
      return { id };
    },
    updateDetails: async (id: string, details: unknown) => {
      calls.push(['updateDetails', id, details]);
      return { id };
    },
    rebase: async (id: string, mode: 'keep' | 'reset') => {
      calls.push(['rebase', id, mode]);
      return { version: 3 };
    },
    ...over
  } as unknown as WorkflowsClient;
  return { client, calls };
};

type ShowOptions = {
  version?: number;
  trail?: TrailStep[];
  comparison?: GraphComparison;
  def?: GraphDef;
  client?: WorkflowsClient;
  url?: string;
};

const show = (d: GraphDetail, options: ShowOptions = {}) => {
  window.history.replaceState(null, '', options.url ?? '/workflows/g1');
  const fake = fakeClient();
  const toasts: ToastInput[] = [];
  const events: string[] = [];
  render(
    createElement(
      ToastProvider,
      { onNotify: (t) => toasts.push(t) },
      createElement(EditorView, {
        detail: d,
        version: options.version ?? 2,
        source: options.def ?? source,
        catalog: createCatalog(testNodes),
        client: options.client ?? fake.client,
        trail: options.trail ?? [],
        nameOf: (id) => ({ p1: 'Process PCR', p0: 'Ingest' })[id] ?? 'Workflow',
        onSaved: () => void events.push('saved'),
        comparison: options.comparison ?? null,
        tables: [],
        onRebased: () => void events.push('rebased')
      })
    )
  );
  return { calls: fake.calls, toasts, events, user: userEvent.setup() };
};

const button = (name: string) => screen.getByRole('button', { name });

const reason = (name: string) =>
  document.getElementById(button(name).getAttribute('aria-describedby') ?? '')?.textContent;

const howTo = () => screen.getByText(/read-only|Select a node/).textContent;

const inputNames = () =>
  within(screen.getByRole('region', { name: 'Inputs' }))
    .queryAllByRole('textbox', { name: 'Name' })
    .map((i) => (i as HTMLInputElement).value);

const savedDef = (call: Call | undefined) => call?.[2] as GraphDef;

const apiError = (message: string, issues: Issue[]) =>
  Object.assign(new Error(message), { status: 422, body: { error: message, issues } });

describe('EditorView', () => {
  describe('on a custom draft', () => {
    it('titles the draft with its key, version and scope', () => {
      show(detail('agency', false));
      assert.ok(screen.getByRole('heading', { level: 1, name: 'Flow' }));
      for (const text of ['acme.flow', 'Draft v2', 'Agency']) assert.ok(screen.getByText(text));
      assert.ok(!screen.queryByText('Unsaved'));
      assert.equal(
        screen.getByRole('link', { name: 'Back to Workflows' }).getAttribute('href'),
        '/workflows'
      );
      assert.ok(!screen.queryByRole('navigation', { name: 'Workflow path' }));
    });

    it('explains how to edit the canvas', () => {
      show(detail('agency', false));
      assert.equal(
        howTo(),
        'Select a node to see what it does and set it up. Drag from one pin to another to connect them, or drop a wire on empty space to add a node that fits; right-click or press A to add any node. Alt+click a wire or pin to disconnect it.'
      );
    });

    it('has nothing to save or undo until something changes', () => {
      show(detail('agency', false));
      assert.equal(reason('Save'), 'No changes to save.');
      assert.equal(reason('Undo'), 'Nothing to undo.');
      assert.equal(reason('Redo'), 'Nothing to redo.');
      assert.equal(reason('Publish'), undefined);
    });

    it('marks the draft unsaved once its inputs change', async () => {
      const { user } = show(detail('agency', false), { url: '/workflows/g1?panel=signature' });
      await user.click(button('Add Input'));
      assert.deepEqual(inputNames(), ['field1']);
      assert.ok(screen.getByText('Unsaved'));
      assert.equal(reason('Publish'), 'Save your changes first.');
    });

    it('saves the changed draft, says so and stays on its version', async () => {
      const { calls, toasts, events, user } = show(detail('agency', false), {
        url: '/workflows/g1?version=2&panel=signature'
      });
      await user.click(button('Add Input'));
      await user.click(button('Save'));
      await waitFor(() => assert.deepEqual(toasts, [{ title: 'Draft v2 saved' }]));
      assert.deepEqual(
        calls.map(([name, id]) => [name, id]),
        [['saveDraft', 'g1']]
      );
      const saved = savedDef(calls[0]);
      assert.deepEqual(saved.signature.inputs, [{ name: 'field1', type: 'string' }]);
      assert.deepEqual(
        saved.nodes.map((n) => n.id),
        ['entry']
      );
      assert.deepEqual(events, ['saved']);
      assert.ok(!screen.queryByText('Unsaved'));
      assert.equal(window.location.search, '?version=2&panel=signature');
    });

    it('opens the new version a save creates', async () => {
      const { client } = fakeClient({ saveDraft: async () => ({ version: 3, issues: [] }) });
      const { user } = show(detail('agency', false), { client, url: '/workflows/g1?version=2' });
      await user.click(button('Arrange Nodes'));
      await user.click(button('Save'));
      await waitFor(() => assert.equal(window.location.search, '?version=3'));
      assert.equal(window.location.pathname, '/workflows/g1');
    });

    it('warns of the problems a saved draft still has', async () => {
      const { client } = fakeClient({
        saveDraft: async () => ({
          version: 2,
          issues: [{ message: 'No return' }, { node: 'entry', message: 'Not wired' }]
        })
      });
      const { toasts, user } = show(detail('agency', false), { client });
      await user.click(button('Arrange Nodes'));
      await user.click(button('Save'));
      await waitFor(() =>
        assert.deepEqual(toasts, [
          {
            intent: 'warning',
            title: 'Draft v2 saved with 2 problems',
            description: 'Fix the highlighted nodes before publishing.'
          }
        ])
      );
      assert.ok(screen.getByText('No return'));
      assert.ok(!screen.queryByText('Not wired', { selector: '[role="status"] *' }));
    });

    it('says why a draft could not be saved and keeps it unsaved', async () => {
      const { client } = fakeClient({
        saveDraft: async () => {
          throw apiError('Invalid graph', [{ message: 'Needs a return' }]);
        }
      });
      const { toasts, events, user } = show(detail('agency', false), { client });
      await user.click(button('Arrange Nodes'));
      await user.click(button('Save'));
      assert.equal((await screen.findByRole('alert')).textContent, 'Invalid graph');
      assert.ok(screen.getByText('Needs a return'));
      assert.ok(screen.getByText('Unsaved'));
      assert.deepEqual(toasts, []);
      assert.deepEqual(events, []);
    });

    it('publishes a clean draft', async () => {
      const { calls, toasts, events, user } = show(detail('agency', false));
      await user.click(button('Publish'));
      await waitFor(() =>
        assert.deepEqual(toasts, [
          { title: 'Flow v2 published', description: 'New runs use this version from now on.' }
        ])
      );
      assert.deepEqual(calls, [['publish', 'g1']]);
      assert.deepEqual(events, ['saved']);
    });

    it('undoes and redoes changes with the buttons and the keyboard', async () => {
      const { user } = show(detail('agency', false), { url: '/workflows/g1?panel=signature' });
      await user.click(button('Add Input'));
      await user.click(button('Undo'));
      assert.deepEqual(inputNames(), []);
      await user.click(button('Redo'));
      assert.deepEqual(inputNames(), ['field1']);
      document.body.focus();
      await user.keyboard('{Control>}z{/Control}');
      assert.deepEqual(inputNames(), []);
      await user.keyboard('{Control>}y{/Control}');
      assert.deepEqual(inputNames(), ['field1']);
      await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
      assert.deepEqual(inputNames(), ['field1']);
    });

    it('adds a Get node for a variable and shows it in place of the panel', async () => {
      const { calls, user } = show(detail('agency', false), {
        url: '/workflows/g1?panel=signature'
      });
      await user.click(button('Add Get lines'));
      assert.equal(window.location.search, '');
      assert.ok(!screen.queryByRole('complementary', { name: 'Inputs and Outputs' }));
      await user.click(button('Save'));
      await waitFor(() => assert.equal(calls.length, 1));
      assert.deepEqual(
        savedDef(calls[0]).nodes.map(({ id, type, config }) => ({ id, type, config })),
        [
          { id: 'entry', type: ENTRY_TYPE, config: undefined },
          { id: 'get1', type: 'std.var.get', config: { name: 'lines' } }
        ]
      );
    });

    it('deletes the workflow once confirmed', async () => {
      const { calls, toasts, user } = show(detail('agency', false));
      await user.click(button('Delete Workflow'));
      const dialog = screen.getByRole('dialog', { name: 'Delete Workflow?' });
      await user.click(within(dialog).getByRole('button', { name: 'Delete Workflow' }));
      await waitFor(() => assert.equal(window.location.pathname, '/workflows'));
      assert.deepEqual(calls, [['remove', 'g1']]);
      assert.deepEqual(toasts, [{ title: 'Workflow deleted', description: 'Flow is gone.' }]);
    });

    it('renames the workflow from its details and reloads it', async () => {
      const { calls, toasts, events, user } = show(detail('agency', false));
      await user.click(button('Details'));
      const dialog = screen.getByRole('dialog', { name: 'Workflow Details' });
      const name = within(dialog).getByRole('textbox', { name: 'Name' });
      assert.equal((name as HTMLInputElement).value, 'Flow');
      await user.clear(name);
      await user.type(name, 'Payer Flow');
      await user.click(within(dialog).getByRole('button', { name: 'Save Details' }));
      await waitFor(() => assert.ok(!screen.queryByRole('dialog', { name: 'Workflow Details' })));
      assert.deepEqual(calls, [['updateDetails', 'g1', { name: 'Payer Flow', description: '' }]]);
      assert.deepEqual(toasts, [{ title: 'Details saved', description: 'Payer Flow is saved.' }]);
      assert.deepEqual(events, ['saved']);
    });

    it('keeps the workflow when the deletion is not confirmed', async () => {
      const { calls, user } = show(detail('agency', false));
      await user.click(button('Delete Workflow'));
      const dialog = screen.getByRole('dialog', { name: 'Delete Workflow?' });
      await user.click(within(dialog).getByRole('button', { name: 'Keep' }));
      assert.deepEqual(calls, []);
      assert.equal(window.location.pathname, '/workflows/g1');
    });

    it('opens another version from the version picker', async () => {
      const { user } = show(detail('agency', false));
      await user.click(button('Version'));
      await user.click(screen.getByRole('option', { name: 'v1' }));
      assert.equal(
        `${window.location.pathname}${window.location.search}`,
        '/workflows/g1?version=1'
      );
    });
  });

  describe('on a published version', () => {
    it('points at the open draft instead of offering a new one', () => {
      show(detail('agency', false), { version: 1 });
      assert.ok(screen.getByText('Published v1'));
      assert.equal(howTo(), 'Published versions are read-only. Open draft v2 to make changes.');
      for (const name of ['Save', 'Publish', 'Add Node', 'Edit as New Draft', 'Undo']) {
        assert.equal(screen.queryByRole('button', { name }), null, name);
      }
    });

    it('starts a new draft from the published version', async () => {
      const { client, calls } = fakeClient({
        saveDraft: async (id, def) => {
          calls.push(['saveDraft', id, def]);
          return { version: 3, issues: [] };
        }
      });
      const { toasts, user } = show(detail('agency', true), { client });
      assert.equal(
        howTo(),
        'Published versions are read-only. Edit as a new draft to make changes.'
      );
      await user.click(button('Edit as New Draft'));
      await waitFor(() => assert.equal(window.location.search, '?version=3'));
      assert.deepEqual(calls, [['saveDraft', 'g1', source]]);
      assert.deepEqual(toasts, [{ title: 'Draft v3 saved' }]);
    });

    it('locks the inputs and outputs, saying why', () => {
      show(detail('agency', true), { url: '/workflows/g1?panel=signature' });
      assert.ok(
        screen.getByText(
          'Published versions are read-only. Open a draft to change what this workflow takes and returns.'
        )
      );
      assert.ok(!screen.queryByRole('button', { name: 'Add Input' }));
    });
  });

  describe('on a built-in', () => {
    it('is read-only and offers to customize it', async () => {
      const { calls, toasts, user } = show(detail('system', true), { version: 1 });
      assert.ok(screen.getByText('Built-in'));
      assert.equal(
        howTo(),
        'Built-in workflows are read-only. Customize this one to change how your agency runs it.'
      );
      for (const name of ['Delete Workflow', 'Remove Override', 'Edit as New Draft', 'Save']) {
        assert.equal(screen.queryByRole('button', { name }), null, name);
      }
      await user.click(button('Customize'));
      await waitFor(() => assert.equal(window.location.pathname, '/workflows/g5'));
      assert.deepEqual(calls, [['override', 'g1']]);
      assert.deepEqual(toasts, [
        {
          title: 'Flow copied for this agency',
          description:
            'Change and publish the copy; new runs then use it everywhere this workflow is used.'
        }
      ]);
    });

    it('says why it could not be customized', async () => {
      const { client } = fakeClient({
        override: async () => {
          throw new Error('Already customized');
        }
      });
      const { user } = show(detail('system', true), { version: 1, client });
      await user.click(button('Customize'));
      assert.equal((await screen.findByRole('alert')).textContent, 'Already customized');
      assert.equal(window.location.pathname, '/workflows/g1');
    });

    it('leads to the agency copy that runs instead', () => {
      show(detail('system', true, { overridden_by: 'g9' }), { version: 1 });
      assert.ok(screen.getByText('Has Agency Copy'));
      assert.equal(
        howTo(),
        'Your agency has its own copy of this built-in workflow; runs use it once it is published. Select a node to see what it does.'
      );
      assert.equal(
        screen.getByRole('link', { name: 'Open Agency Copy' }).getAttribute('href'),
        '/workflows/g9'
      );
      assert.ok(!screen.queryByRole('button', { name: 'Customize' }));
    });

    it('shows its inputs and outputs read-only', () => {
      show(detail('system', true), { version: 1, url: '/workflows/g1?panel=signature' });
      assert.ok(
        screen.getByText(
          'Built-in workflows are read-only. This is what it takes in, hands back and keeps while it runs.'
        )
      );
    });
  });

  describe('on an agency copy', () => {
    const changed: GraphDef = {
      ...source,
      nodes: [...source.nodes, { id: 'add1', type: 'std.math.add', version: 1 }]
    };
    const comparison = (baseChanged: boolean): GraphComparison => ({
      mine: { version: 2, definition: changed },
      copiedFrom: {
        version: 1,
        scope: 'system',
        definition: {
          ...source,
          nodes: [...source.nodes, { id: 'gone', type: 'std.math.add', version: 1 }]
        }
      },
      latest: { version: baseChanged ? 2 : 1, definition: source },
      baseChanged
    });
    const copy = detail('agency', false, { overrides: 'g0' });

    it('keeps the inputs and outputs of the built-in', () => {
      show(copy, { url: '/workflows/g1?panel=signature' });
      assert.ok(
        screen.getByText(
          'A copy keeps the inputs and outputs of the built-in workflow it overrides, so everything that uses it keeps working.'
        )
      );
      assert.ok(!screen.queryByRole('button', { name: 'Add Input' }));
      assert.ok(!screen.queryByRole('button', { name: 'Add Get lines' }));
    });

    it('warns when the base moved on, with links to compare and show removed nodes', () => {
      show(copy, { comparison: comparison(true), def: changed, url: '/workflows/g1?version=2' });
      assert.ok(screen.getByText('Base Updated', { selector: 'span' }));
      assert.ok(screen.getByText(/^The base has changed since this copy was made/));
      assert.deepEqual(
        screen.getAllByRole('link', { name: 'Compare' }).map((a) => a.getAttribute('href')),
        ['/workflows/g1?version=2&panel=compare', '/workflows/g1?version=2&panel=compare']
      );
      assert.equal(
        screen.getByRole('link', { name: 'Show Removed' }).getAttribute('href'),
        '/workflows/g1?version=2&removed=shown'
      );
    });

    it('says nothing of the base while it is unchanged', () => {
      show(copy, { comparison: comparison(false), def: changed });
      assert.ok(!screen.queryByText(/Base Updated/));
      assert.equal(screen.getAllByRole('link', { name: 'Compare' }).length, 1);
    });

    it('offers to hide removed nodes once shown', () => {
      show(copy, {
        comparison: comparison(false),
        def: changed,
        url: '/workflows/g1?removed=shown'
      });
      assert.equal(
        screen.getByRole('link', { name: 'Hide Removed' }).getAttribute('href'),
        '/workflows/g1'
      );
    });

    it('keeps its changes on the newest base', async () => {
      const { calls, toasts, events, user } = show(copy, {
        comparison: comparison(true),
        def: changed,
        url: '/workflows/g1?panel=compare'
      });
      await user.click(button('Keep Mine'));
      await waitFor(() => assert.deepEqual(events, ['rebased']));
      assert.deepEqual(calls, [['rebase', 'g1', 'keep']]);
      assert.deepEqual(toasts, [
        { title: 'Kept your changes', description: 'Your draft is now based on the newest base.' }
      ]);
      assert.equal(`${window.location.pathname}${window.location.search}`, '/workflows/g1');
    });

    it('starts again from the base once confirmed', async () => {
      const { calls, toasts, user } = show(copy, {
        comparison: comparison(true),
        def: changed,
        url: '/workflows/g1?panel=compare'
      });
      await user.click(button('Start From Base'));
      const dialog = screen.getByRole('dialog', { name: 'Start From Base?' });
      await user.click(within(dialog).getByRole('button', { name: 'Start From Base' }));
      await waitFor(() => assert.deepEqual(calls, [['rebase', 'g1', 'reset']]));
      assert.deepEqual(toasts, [
        { title: 'Started from the base', description: 'Your draft is the newest base again.' }
      ]);
    });

    it('removes the override and returns to the built-in', async () => {
      const { calls, toasts, user } = show(copy);
      await user.click(button('Remove Override'));
      const dialog = screen.getByRole('dialog', { name: 'Remove Override?' });
      await user.click(within(dialog).getByRole('button', { name: 'Remove Override' }));
      await waitFor(() => assert.equal(window.location.pathname, '/workflows/g0'));
      assert.deepEqual(calls, [['remove', 'g1']]);
      assert.deepEqual(toasts, [
        {
          title: 'Override removed',
          description: 'New runs use the Flow this copy overrode again.'
        }
      ]);
      assert.ok(!screen.queryByRole('button', { name: 'Delete Workflow' }));
    });

    it('cannot be removed without edit rights', () => {
      show(detail('agency', true, { overrides: 'g0' }, { canEdit: false }));
      assert.ok(!screen.queryByRole('button', { name: 'Remove Override' }));
    });
  });

  it('shows where a subworkflow was opened from and leads back up', () => {
    show(detail('agency', true), {
      trail: [
        { graphId: 'p0', version: 1 },
        { graphId: 'p1', version: 3 }
      ]
    });
    const path = screen.getByRole('navigation', { name: 'Workflow path' });
    assert.deepEqual(
      within(path)
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')]),
      [
        ['Workflows', '/workflows'],
        ['Ingest', '/workflows/p0?version=1'],
        ['Process PCR', '/workflows/p1?version=3&trail=p0:1']
      ]
    );
    assert.equal(within(path).getByText('Flow').getAttribute('aria-current'), 'page');
    assert.equal(
      screen.getByRole('link', { name: 'Back to Process PCR' }).getAttribute('href'),
      '/workflows/p1?version=3&trail=p0:1'
    );
  });
});

describe('customizedNodes', () => {
  it('marks nodes whose subworkflow is overridden or whose table is not built-in', () => {
    const def: GraphDef = {
      ...source,
      nodes: [
        { id: 'sub', type: 'acme.rule', version: 1 },
        { id: 'plain', type: 'acme.plain', version: 1 },
        {
          id: 'rates',
          type: 'std.table.lookup',
          version: 1,
          config: { type: 'string', table: { key: 'acme.rates' } }
        },
        {
          id: 'codes',
          type: 'std.table.lookup',
          version: 1,
          config: { type: 'string', table: { key: 'acme.codes' } }
        },
        {
          id: 'unknown',
          type: 'std.table.lookup',
          version: 1,
          config: { type: 'string', table: { key: 'acme.unknown' } }
        }
      ]
    };
    const published = (key: string, overridden: boolean) => ({
      graph_id: key,
      key,
      name: key,
      kind: 'node' as const,
      role: 'rule' as const,
      description: '',
      version: 1,
      signature: { execIn: [], execOut: [], inputs: [], outputs: [] },
      overridden
    });
    const catalog = createCatalog(testNodes, {
      published: [published('acme.rule', true), published('acme.plain', false)]
    });
    const tables = new Map([
      ['acme.rates', { id: 't1', key: 'acme.rates', name: 'Rates', scope: 'agency' as const }],
      ['acme.codes', { id: 't2', key: 'acme.codes', name: 'Codes', scope: 'system' as const }]
    ]);
    assert.deepEqual(customizedNodes(def, catalog, tables), {
      sub: 'overridden',
      rates: 'overridden'
    });
  });
});

describe('pinHint', () => {
  const def: GraphDef = {
    ...source,
    nodes: [...source.nodes, { id: 'add1', type: 'std.math.add', version: 1 }]
  };
  const catalog = createCatalog(testNodes);

  it('names a data pin and the node it is on', () => {
    assert.equal(
      pinHint(def, catalog, { node: 'add1', pin: 'result', side: 'out' }),
      'Nodes that connect to Result on Add.'
    );
  });

  it('calls an unlabelled execution pin the flow', () => {
    assert.equal(
      pinHint(def, catalog, { node: 'entry', pin: 'exec', side: 'out' }),
      'Nodes that connect to the flow on Entry.'
    );
  });

  it('falls back to this pin for a node that is gone', () => {
    assert.equal(
      pinHint(def, catalog, { node: 'gone', pin: 'x', side: 'in' }),
      'Nodes that connect to this pin.'
    );
  });
});

describe('lockedReason', () => {
  it('keeps the contract of a copy, even as a draft', () => {
    assert.equal(
      lockedReason({ scope: 'agency', overrides: 'g0' }, true, 'subworkflow'),
      'A copy keeps the inputs and outputs of the built-in subworkflow it overrides, so everything that uses it keeps working.'
    );
  });

  it('keeps a built-in read-only', () => {
    assert.equal(
      lockedReason({ scope: 'system', overrides: null }, false, 'workflow'),
      'Built-in workflows are read-only. This is what it takes in, hands back and keeps while it runs.'
    );
  });

  it('keeps a published version read-only and leaves a custom draft open', () => {
    assert.equal(
      lockedReason({ scope: 'agency', overrides: null }, false, 'workflow'),
      'Published versions are read-only. Open a draft to change what this workflow takes and returns.'
    );
    assert.equal(lockedReason({ scope: 'agency', overrides: null }, true, 'workflow'), null);
  });
});

describe('EditorPage', () => {
  const pageClient = (over: Partial<WorkflowsClient> = {}) => {
    const loaded: [string, ...unknown[]][] = [];
    const client = {
      find: async (id: string) => {
        loaded.push(['find', id]);
        return detail('agency', false);
      },
      nodes: async () => [],
      version: async (id: string, version: number) => {
        loaded.push(['version', id, version]);
        return { id: `v${version}`, version, definition: source, published_at: null };
      },
      compare: async () => ({ mine: null, copiedFrom: null, latest: null, baseChanged: false }),
      tables: { effective: async () => [] },
      ...over
    } as unknown as WorkflowsClient;
    return { client, loaded };
  };

  const showPage = (client: WorkflowsClient, version: number | null) =>
    render(
      createElement(EditorPage, {
        live: idleLive,
        client,
        nodes: testNodes,
        graphId: 'g1',
        version,
        trail: []
      })
    );

  it('waits for the graph before showing the editor', () => {
    const { client } = pageClient({ find: () => new Promise(() => undefined) });
    showPage(client, null);
    assert.ok(screen.getByRole('status', { name: 'Loading' }));
    assert.ok(!screen.queryByRole('heading', { level: 1 }));
  });

  it('opens the draft when no version is asked for, putting it in the URL', async () => {
    window.history.replaceState(null, '', '/workflows/g1');
    const { client, loaded } = pageClient();
    showPage(client, null);
    await screen.findByRole('heading', { level: 1, name: 'Flow' });
    assert.equal(window.location.search, '?version=2');
    assert.deepEqual(loaded, [
      ['find', 'g1'],
      ['version', 'g1', 2]
    ]);
  });

  it('opens the version asked for', async () => {
    window.history.replaceState(null, '', '/workflows/g1?version=1');
    const { client, loaded } = pageClient();
    showPage(client, 1);
    assert.ok(await screen.findByText('Published v1'));
    assert.deepEqual(loaded, [
      ['find', 'g1'],
      ['version', 'g1', 1]
    ]);
  });

  it('says why the graph could not be loaded', async () => {
    const { client } = pageClient({
      find: async () => {
        throw new Error('Graph not found');
      }
    });
    showPage(client, 2);
    assert.ok(await screen.findByRole('heading', { level: 1, name: 'Something Went Wrong' }));
    assert.ok(screen.getByText('Graph not found'));
  });
});
