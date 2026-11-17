import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ReactFlowProvider } from '@xyflow/react';
import { createElement } from 'react';
import { render, screen, userEvent, within } from '../testing-dom.ts';
import type { GraphNodeData } from './flow.ts';
import { fieldMatches, GraphNode, NodeActions, pinTitle } from './graph-node.tsx';

const props = {
  id: 'n',
  type: 'graph' as const,
  dragging: false,
  zIndex: 0,
  isConnectable: true,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
  draggable: true,
  selectable: true,
  deletable: true
};

const noPins = { execIn: [], execOut: [], inputs: [], outputs: [] };

const base: GraphNodeData = {
  instance: {
    id: 'n',
    type: 'std.math.add',
    version: 1,
    inputs: { a: { value: 12 }, b: { expr: 'total * 2' } }
  },
  title: 'Add',
  description: 'Adds two numbers (a + b).',
  summary: null,
  kind: 'action',
  exits: {},
  fold: null,
  signature: {
    execIn: ['exec'],
    execOut: ['then', 'failed'],
    inputs: [
      { name: 'a', type: 'number' },
      { name: 'b', type: 'number' }
    ],
    outputs: [{ name: 'result', type: 'number' }]
  },
  connected: ['b'],
  status: 'idle',
  issues: [],
  opens: null,
  change: null,
  ghost: false
};

const folded: GraphNodeData = {
  ...base,
  kind: 'pure',
  signature: {
    ...noPins,
    outputs: [
      { name: 'payer', type: 'string', label: 'Payer' },
      { name: 'zip', type: 'string', label: 'Postal Code' },
      { name: 'total', type: 'number', label: 'Total' }
    ]
  },
  fold: { side: 'out', shown: ['total'] }
};

const show = (patch: Partial<GraphNodeData> = {}, { selected = false, editable = false } = {}) => {
  const broken: [string, string, string][] = [];
  const revealed: [string, string][] = [];
  const node = createElement(ReactFlowProvider, {
    children: createElement(GraphNode, { ...props, data: { ...base, ...patch }, selected })
  });
  render(
    editable
      ? createElement(NodeActions, {
          value: {
            breakPin: (n, pin, side) => broken.push([n, pin, side]),
            revealPin: (n, pin) => revealed.push([n, pin])
          },
          children: node
        })
      : node
  );
  return { broken, revealed, user: userEvent.setup() };
};

const card = (name = 'Add') => screen.getByRole('article', { name });

const pinRows = (side: 'in' | 'out') => {
  const lists = within(card()).getAllByRole('list');
  const list = lists[side === 'in' ? 0 : 1];
  assert.ok(list);
  return within(list)
    .queryAllByRole('listitem')
    .map((li) => [li.getAttribute('title'), li.textContent]);
};

const handle = (pin: string) => card().querySelector(`[data-handleid="${pin}"]`);

const hasClass = (el: Element | null | undefined, name: string) =>
  el?.classList.contains(name) ?? false;

describe('pinTitle', () => {
  const kinds = { id: {}, code: { hcpcs: 'HCPCS Code' } };

  it('names a data pin with its type and description', () => {
    assert.equal(
      pinTitle(
        { name: 'a', label: 'A', exec: false, spec: { name: 'a', type: { code: 'hcpcs' } } },
        kinds
      ),
      'A: HCPCS Code'
    );
    assert.equal(
      pinTitle(
        {
          name: 'a',
          label: 'A',
          exec: false,
          spec: { name: 'a', type: 'number', description: 'The first number' }
        },
        kinds
      ),
      'A: Number. The first number'
    );
  });

  it('names an exec pin as execution flow, with its exit doc', () => {
    assert.equal(pinTitle({ name: 'then', label: '', exec: true }, kinds), 'Execution flow');
    assert.equal(
      pinTitle(
        {
          name: 'failed',
          label: 'Gave Up',
          exec: true,
          doc: { label: 'Gave Up', description: 'Every retry failed' }
        },
        kinds
      ),
      'Gave Up: Execution flow. Every retry failed'
    );
  });
});

describe('fieldMatches', () => {
  const pins = [
    { name: 'payer', label: 'Payer', exec: false },
    { name: 'zip', label: 'Postal Code', exec: false }
  ];

  it('finds fields by label or name, ignoring case', () => {
    assert.deepEqual(
      fieldMatches(pins, 'POST').map((p) => p.name),
      ['zip']
    );
    assert.deepEqual(
      fieldMatches(pins, 'zip').map((p) => p.name),
      ['zip']
    );
  });

  it('keeps every field for a blank query', () => {
    assert.deepEqual(fieldMatches(pins, ' '), pins);
  });
});

describe('GraphNode pins', () => {
  it('lists the input and output pins with their types, naming only exits that need it', () => {
    show();
    assert.deepEqual(pinRows('in'), [
      ['Execution flow', ''],
      ['A: Number', 'A12'],
      ['B: Number', 'B']
    ]);
    assert.deepEqual(pinRows('out'), [
      ['Execution flow', ''],
      ['Failed: Execution flow', 'Failed'],
      ['Result: Number', 'Result']
    ]);
  });

  it('gives each pin a handle on its side', () => {
    show();
    assert.deepEqual(
      [...card().querySelectorAll('[data-handleid]')].map((h) => [
        h.getAttribute('data-handleid'),
        hasClass(h, 'target'),
        hasClass(h, 'source')
      ]),
      [
        ['exec', true, false],
        ['a', true, false],
        ['b', true, false],
        ['then', false, true],
        ['failed', false, true],
        ['result', false, true]
      ]
    );
  });

  it('draws exec pins as triangles and data pins as dots colored by type', () => {
    show({
      signature: {
        ...noPins,
        execIn: ['exec'],
        inputs: [
          { name: 'v', type: 'any' },
          { name: 'n', type: 'number' }
        ]
      }
    });
    assert.deepEqual(
      [
        hasClass(handle('exec'), 'bg-surface-fg'),
        handle('exec')?.className.includes('clip-path:polygon')
      ],
      [true, true]
    );
    assert.deepEqual(
      [hasClass(handle('v'), 'bg-surface-fg-muted/60'), hasClass(handle('v'), 'rounded-full!')],
      [true, true]
    );
    assert.equal(hasClass(handle('n'), 'bg-pin-number'), true);
  });

  it('previews unwired expressions and shortens long literals', () => {
    show({
      connected: [],
      instance: {
        ...base.instance,
        inputs: { a: { value: 'a long literal value' }, b: { expr: 'total * 2' } }
      }
    });
    assert.deepEqual(
      pinRows('in')
        .slice(1)
        .map(([, text]) => text),
      ['A"a long literal v…', 'B= total * 2']
    );
  });

  it('documents exits with their own labels', () => {
    show({
      signature: { ...noPins, execOut: ['failed'] },
      exits: { failed: { label: 'Gave Up', description: 'Every retry failed' } }
    });
    assert.deepEqual(pinRows('out'), [['Gave Up: Execution flow. Every retry failed', 'Gave Up']]);
  });

  it('breaks a pin when it is alt-clicked while editing', async () => {
    const { broken, user } = show({}, { editable: true });
    const a = handle('a');
    const result = handle('result');
    assert.ok(a && result);
    await user.click(a);
    assert.deepEqual(broken, []);
    await user.keyboard('{Alt>}');
    await user.click(a);
    await user.click(result);
    await user.keyboard('{/Alt}');
    assert.deepEqual(broken, [
      ['n', 'a', 'in'],
      ['n', 'result', 'out']
    ]);
  });

  it('says when the node is unknown', () => {
    show({ signature: null });
    assert.ok(within(card()).getByText('Unknown node std.math.add@1'));
    assert.ok(!within(card()).queryByRole('list'));
  });
});

describe('GraphNode header', () => {
  it('shows the title and description', () => {
    show();
    const header = within(card()).getByRole('banner');
    assert.equal(header.getAttribute('title'), 'Adds two numbers (a + b).');
    assert.equal(header.textContent, 'AddAdds two numbers (a + b).');
  });

  it('shows the summary instead of the description', () => {
    show({ summary: 'Task: Match payer' });
    assert.equal(within(card()).getByRole('banner').textContent, 'AddTask: Match payer');
  });

  it('leaves out the description of a pure node', () => {
    show({ kind: 'pure' });
    const header = within(card()).getByRole('banner');
    assert.equal(header.textContent, 'Add');
    assert.equal(hasClass(header, 'border-t-4'), false);
  });

  it('colors the header by the kind of node', () => {
    show({ kind: 'human' });
    const header = within(card()).getByRole('banner');
    assert.deepEqual(
      [hasClass(header, 'bg-node-human/15'), hasClass(header, 'border-t-node-human')],
      [true, true]
    );
  });

  it('says what a node that calls a graph opens as', () => {
    show({ opens: 'graph' });
    assert.equal(
      within(card()).getByRole('banner').textContent,
      'AddSubworkflowAdds two numbers (a + b).'
    );
  });

  it('shows the note on the node', () => {
    show({ instance: { ...base.instance, note: 'Ask billing first' } });
    assert.ok(within(card()).getByText('Ask billing first'));
  });
});

describe('GraphNode state', () => {
  it('borders the node by its run status', () => {
    const cases = [
      ['idle', 'border-border'],
      ['done', 'border-success'],
      ['error', 'border-danger'],
      ['waiting', 'animate-pulse']
    ] as const;
    for (const [status, border] of cases) {
      const { unmount } = render(
        createElement(ReactFlowProvider, {
          children: createElement(GraphNode, {
            ...props,
            data: { ...base, status },
            selected: false
          })
        })
      );
      assert.equal(hasClass(card(), border), true, status);
      unmount();
    }
  });

  it('rings the node while it is selected', () => {
    show({}, { selected: true });
    assert.equal(hasClass(card(), 'ring-primary'), true);
  });

  it('shows the first issue and how many more there are', () => {
    show({ issues: ['Bad', 'Worse'] });
    assert.equal(within(card()).getByRole('contentinfo').textContent, 'Bad (+1)');
  });

  it('outlines a customized node and says how it was changed', () => {
    show({ change: 'overridden' });
    assert.equal(hasClass(card(), 'border-custom'), true);
    assert.equal(
      within(card()).getByText('Custom').parentElement?.getAttribute('title'),
      'Your agency overrides this'
    );
  });

  it('keeps the status border of a customized node that is not idle', () => {
    show({ change: 'added', status: 'error' });
    assert.deepEqual(
      [hasClass(card(), 'border-danger'), hasClass(card(), 'border-custom')],
      [true, false]
    );
  });

  it('dims a node removed from the base', () => {
    show({ ghost: true });
    const ghost = card('Add (removed)');
    assert.deepEqual(
      [hasClass(ghost, 'border-dashed'), hasClass(ghost, 'pointer-events-none')],
      [true, true]
    );
    assert.equal(
      within(ghost).getByText('Removed').parentElement?.getAttribute('title'),
      'Removed from the base'
    );
  });
});

describe('GraphNode folded fields', () => {
  it('shows only the used fields of a break node', () => {
    show(folded);
    assert.deepEqual(
      [...card().querySelectorAll('[data-handleid]')].map((h) => h.getAttribute('data-handleid')),
      ['total']
    );
  });

  it('offers no hidden fields when read-only', () => {
    show(folded);
    assert.ok(!screen.queryByRole('button', { name: 'Add Field' }));
  });

  it('finds a hidden field and reveals it', async () => {
    const { revealed, user } = show(folded, { editable: true });
    await user.click(screen.getByRole('button', { name: 'Add Field' }));
    assert.deepEqual(
      screen.getAllByRole('button').map((b) => b.textContent),
      ['Payer', 'Postal Code']
    );
    await user.type(screen.getByRole('searchbox', { name: 'Find Field' }), 'post');
    await user.click(screen.getByRole('button', { name: 'Postal Code' }));
    assert.deepEqual(revealed, [['n', 'zip']]);
    assert.ok(screen.getByRole('button', { name: 'Add Field' }));
  });

  it('reveals the first match on Enter and closes on Escape', async () => {
    const { revealed, user } = show(folded, { editable: true });
    await user.click(screen.getByRole('button', { name: 'Add Field' }));
    await user.keyboard('{Escape}');
    assert.deepEqual(revealed, []);
    await user.click(screen.getByRole('button', { name: 'Add Field' }));
    await user.keyboard('pay{Enter}');
    assert.deepEqual(revealed, [['n', 'payer']]);
  });

  it('moves focus into the field finder and back to Add Field when it closes', async () => {
    const { user } = show(folded, { editable: true });
    await user.click(screen.getByRole('button', { name: 'Add Field' }));
    assert.ok(document.activeElement === screen.getByRole('searchbox', { name: 'Find Field' }));
    await user.keyboard('{Escape}');
    assert.ok(document.activeElement === screen.getByRole('button', { name: 'Add Field' }));
  });

  it('offers no fields when every one is shown', () => {
    show(
      { ...folded, fold: { side: 'out', shown: ['payer', 'zip', 'total'] } },
      { editable: true }
    );
    assert.ok(!screen.queryByRole('button', { name: 'Add Field' }));
  });
});

describe('GraphNode reroute', () => {
  it('draws a reroute as a small knot colored by its type', () => {
    show({
      title: 'Reroute',
      instance: { id: 'n', type: 'std.flow.reroute', version: 1 },
      kind: 'flow',
      signature: {
        ...noPins,
        inputs: [{ name: 'value', type: 'number' }],
        outputs: [{ name: 'value', type: 'number' }]
      }
    });
    const knot = screen.getByRole('img', { name: 'Reroute' });
    assert.equal(hasClass(knot, 'bg-pin-number'), true);
    assert.equal(knot.querySelectorAll('[data-handleid="value"]').length, 2);
    assert.ok(!screen.queryByRole('article'));
  });
});
