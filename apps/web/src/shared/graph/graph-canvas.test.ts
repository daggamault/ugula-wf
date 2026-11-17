import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef } from '@ugula/graph';
import { createElement, useState } from 'react';
import { testNodes } from '../testing.ts';
import { render, screen, userEvent, waitFor } from '../testing-dom.ts';
import { createCatalog } from './catalog.ts';
import { clipOf, clipText } from './clipboard.ts';
import {
  GraphCanvas,
  isTyping,
  nodeClicks,
  OPENING_WIDTH,
  openingNodes,
  selectionOf
} from './graph-canvas.tsx';

const catalog = createCatalog(testNodes);

const def: GraphDef = {
  signature: {
    execIn: ['exec'],
    execOut: [],
    inputs: [{ name: 'x', type: 'number' }],
    outputs: []
  },
  variables: [],
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1, position: { x: 0, y: 0 } },
    { id: 'add1', type: 'std.math.add', version: 1, position: { x: 300, y: 0 } }
  ],
  edges: [{ from: 'entry', fromPin: 'x', to: 'add1', toPin: 'a' }]
};

const pricing = {
  id: 'comment1',
  text: 'Pricing',
  position: { x: 0, y: 0 },
  size: { width: 300, height: 200 }
};

const show = (
  start: GraphDef = def,
  {
    editable = true,
    selected = null,
    tools
  }: { editable?: boolean; selected?: string | null; tools?: string } = {}
) => {
  const changes: GraphDef[] = [];
  const selects: (string | null)[] = [];
  const Host = () => {
    const [current, setCurrent] = useState(start);
    const [picked, setPicked] = useState(selected);
    return createElement(GraphCanvas, {
      def: current,
      catalog,
      selected: picked,
      onSelect: (id) => {
        selects.push(id);
        setPicked(id);
      },
      ...(editable
        ? {
            onChange: (next: GraphDef) => {
              changes.push(next);
              setCurrent(next);
            }
          }
        : {}),
      ...(tools ? { tools: createElement('span', null, tools) } : {})
    });
  };
  render(createElement(Host));
  return { changes, selects, user: userEvent.setup() };
};

const flowNode = (id: string) => document.querySelector(`.react-flow__node[data-id="${id}"]`);

const isSelected = (id: string) => flowNode(id)?.classList.contains('selected') ?? false;

describe('isTyping', () => {
  it('is typing in text fields, selects and editable content', () => {
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    assert.deepEqual(
      [
        document.createElement('input'),
        document.createElement('textarea'),
        document.createElement('select'),
        editable
      ].map(isTyping),
      [true, true, true, true]
    );
  });

  it('is not typing anywhere else', () => {
    assert.deepEqual([document.createElement('button'), document.body, null].map(isTyping), [
      false,
      false,
      false
    ]);
  });
});

describe('selectionOf', () => {
  it('splits the selection into graph nodes and comment frames, skipping ghosts', () => {
    const node = (id: string, selected: boolean, ghost = false) => ({
      id,
      type: 'graph' as const,
      position: { x: 0, y: 0 },
      selected,
      data: { ghost } as never
    });
    assert.deepEqual(
      selectionOf([
        node('a', true),
        node('b', false),
        node('removed:c', true, true),
        {
          id: 'comment:comment1',
          type: 'comment' as const,
          position: { x: 0, y: 0 },
          selected: true,
          data: { comment: pricing }
        }
      ]),
      { nodes: ['a'], comments: ['comment1'] }
    );
  });

  it('is empty when nothing is selected', () => {
    assert.deepEqual(selectionOf([]), { nodes: [], comments: [] });
  });
});

describe('openingNodes', () => {
  it('opens a wide graph at its start so nodes stay readable', () => {
    assert.deepEqual(
      openingNodes([
        { id: 'b', position: { x: 300 } },
        { id: 'a', position: { x: -100 } },
        { id: 'edge', position: { x: OPENING_WIDTH - 100 } },
        { id: 'far', position: { x: OPENING_WIDTH } }
      ]),
      [{ id: 'b' }, { id: 'a' }, { id: 'edge' }]
    );
  });
});

describe('nodeClicks', () => {
  it('selects at once a node that does not open', () => {
    const selected: string[] = [];
    const clicks = nodeClicks({
      onSelect: (id) => void selected.push(id),
      onOpen: () => undefined
    });
    clicks.click('plain', false);
    assert.deepEqual(selected, ['plain']);
  });

  it('selects at once when nothing can be opened', () => {
    const selected: string[] = [];
    nodeClicks({ onSelect: (id) => void selected.push(id) }).click('block', true);
    assert.deepEqual(selected, ['block']);
  });

  it('waits out a double-click before selecting a node that opens', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const selected: string[] = [];
    const clicks = nodeClicks({
      onSelect: (id) => void selected.push(id),
      onOpen: () => undefined,
      delayMs: 5
    });
    clicks.click('block', true);
    t.mock.timers.tick(4);
    assert.deepEqual(selected, []);
    t.mock.timers.tick(1);
    assert.deepEqual(selected, ['block']);
  });

  it('opens on a double-click without selecting', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const selected: string[] = [];
    const opened: string[] = [];
    const clicks = nodeClicks({
      onSelect: (id) => void selected.push(id),
      onOpen: (id) => void opened.push(id),
      delayMs: 5
    });
    clicks.click('block', true);
    clicks.doubleClick('block', true);
    t.mock.timers.tick(20);
    assert.deepEqual([selected, opened], [[], ['block']]);
  });

  it('never opens a node that does not open', () => {
    const opened: string[] = [];
    nodeClicks({ onSelect: () => undefined, onOpen: (id) => void opened.push(id) }).doubleClick(
      'plain',
      false
    );
    assert.deepEqual(opened, []);
  });

  it('selects only the last of two quick clicks, and none once cancelled', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const selected: string[] = [];
    const clicks = nodeClicks({
      onSelect: (id) => void selected.push(id),
      onOpen: () => undefined
    });
    clicks.click('a', true);
    clicks.click('b', true);
    t.mock.timers.tick(1000);
    assert.deepEqual(selected, ['b']);
    clicks.click('c', true);
    clicks.cancel();
    t.mock.timers.tick(1000);
    assert.deepEqual(selected, ['b']);
  });
});

describe('GraphCanvas', () => {
  it('draws every node of the graph with the canvas controls', () => {
    show(def, { editable: false });
    assert.deepEqual(
      screen.getAllByRole('article', { hidden: true }).map((a) => a.getAttribute('aria-label')),
      ['Entry', 'Add']
    );
    assert.deepEqual(
      screen.getAllByRole('button').map((b) => b.getAttribute('aria-label')),
      ['Zoom In', 'Zoom Out', 'Fit View']
    );
  });

  it('draws the comment frames of the graph', () => {
    show({ ...def, comments: [pricing] }, { editable: false });
    assert.ok(screen.getByRole('region', { name: 'Pricing', hidden: true }));
  });

  it('offers no editing tools on a read-only canvas, only the given tools', () => {
    show(def, { editable: false, tools: 'Undo Tool' });
    assert.ok(screen.getByText('Undo Tool'));
    assert.ok(!screen.queryByRole('button', { name: 'Add Comment' }));
  });

  it('offers the given tools beside adding a comment when editing', () => {
    show(def, { tools: 'Undo Tool' });
    assert.ok(screen.getByText('Undo Tool'));
    assert.ok(screen.getByRole('button', { name: 'Add Comment' }));
  });

  it('selects the node it is told is selected', () => {
    show(def, { selected: 'add1' });
    assert.deepEqual([isSelected('add1'), isSelected('entry')], [true, false]);
  });

  it('keeps the selection it opens with', async () => {
    const { selects } = show(def, { selected: 'add1' });
    await waitFor(() => assert.equal(isSelected('add1'), true));
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(selects, []);
  });

  it('clears the selection when the selected node is deselected', async () => {
    const { selects, user } = show(def, { selected: 'add1' });
    await waitFor(() => assert.equal(isSelected('add1'), true));
    await user.click(document.querySelector('.react-flow__pane') as HTMLElement);
    assert.deepEqual(selects, [null, null]);
  });

  it('selects a node when it is clicked', async () => {
    const { selects, user } = show(def);
    await user.click(flowNode('add1') as HTMLElement);
    assert.deepEqual(selects, ['add1']);
    await waitFor(() => assert.equal(isSelected('add1'), true));
  });

  it('clears the selection when the canvas is clicked', async () => {
    const { selects, user } = show(def);
    await user.click(document.querySelector('.react-flow__pane') as HTMLElement);
    assert.deepEqual(selects, [null]);
  });

  it('frames the selected nodes in a new comment and selects it', async () => {
    const { changes, user } = show(def, { selected: 'add1' });
    await user.click(screen.getByRole('button', { name: 'Add Comment' }));
    assert.deepEqual(changes.at(-1)?.comments, [
      {
        id: 'comment1',
        text: 'Comment',
        position: { x: 260, y: -88 },
        size: { width: 320, height: 224 }
      }
    ]);
    await waitFor(() => assert.equal(isSelected('comment:comment1'), true));
    assert.equal(isSelected('add1'), false);
  });

  it('frames the selected nodes on the C key', async () => {
    const { changes, user } = show(def, { selected: 'add1' });
    await user.keyboard('c');
    assert.equal(changes.length, 1);
    assert.deepEqual(
      changes[0]?.comments?.map((c) => c.id),
      ['comment1']
    );
  });

  it('adds no comment on the C key without a selection', async () => {
    const { changes, user } = show(def);
    await user.keyboard('c');
    assert.deepEqual(changes, []);
  });

  it('duplicates the selected nodes on Ctrl+D, selecting the copies', async () => {
    const { changes, selects, user } = show(def);
    await user.click(flowNode('add1') as HTMLElement);
    await user.keyboard('{Control>}d{/Control}');
    assert.deepEqual(changes.at(-1)?.nodes.at(-1), {
      id: 'add2',
      type: 'std.math.add',
      version: 1,
      position: { x: 340, y: 40 }
    });
    assert.deepEqual(selects, ['add1', null]);
    await waitFor(() => assert.equal(isSelected('add2'), true));
  });

  it('copies the selected nodes to the clipboard', async () => {
    show(def, { selected: 'add1' });
    const clipboardData = new DataTransfer();
    document.dispatchEvent(new ClipboardEvent('copy', { clipboardData, bubbles: true }));
    assert.equal(clipboardData.getData('text/plain'), clipText(clipOf(def, ['add1'])));
  });

  it('pastes a copied clip as new nodes', async () => {
    const { changes, selects, user } = show(def);
    await user.paste(clipText(clipOf(def, ['add1'])));
    assert.deepEqual(
      changes.at(-1)?.nodes.map((n) => n.id),
      ['entry', 'add1', 'add2']
    );
    assert.deepEqual(selects, [null]);
  });

  it('ignores pasted text that is not a clip', async () => {
    const { changes, selects, user } = show(def);
    await user.paste('hello');
    assert.deepEqual([changes, selects], [[], []]);
  });

  it('leaves keys, copying and pasting alone while typing', async () => {
    const { changes, user } = show({ ...def, comments: [pricing] }, { selected: 'add1' });
    const title = screen.getByRole('textbox', { name: 'Comment Title', hidden: true });
    title.focus();
    await user.keyboard('{Control>}d{/Control}');
    await user.paste(clipText(clipOf(def, ['add1'])));
    assert.deepEqual(
      changes.map((c) => c.comments?.[0]?.text),
      [`Pricing${clipText(clipOf(def, ['add1']))}`]
    );
  });

  it('changes nothing from keys or the clipboard when read-only', async () => {
    const { selects, user } = show(def, { editable: false });
    await user.click(flowNode('add1') as HTMLElement);
    await user.keyboard('c{Control>}d{/Control}');
    await user.paste(clipText(clipOf(def, ['add1'])));
    assert.deepEqual(selects, ['add1']);
  });

  it('edits a comment title in place', async () => {
    const { changes, user } = show({ ...def, comments: [pricing] });
    await user.type(screen.getByRole('textbox', { name: 'Comment Title', hidden: true }), 's');
    assert.deepEqual(changes.at(-1)?.comments, [{ ...pricing, text: 'Pricings' }]);
  });

  it('breaks the wires on a pin when it is alt-clicked', async () => {
    const { changes, user } = show(def);
    const pin = flowNode('add1')?.querySelector('[data-handleid="a"]');
    assert.ok(pin);
    await user.keyboard('{Alt>}');
    await user.click(pin);
    await user.keyboard('{/Alt}');
    assert.deepEqual(changes.at(-1)?.edges, []);
  });
});
