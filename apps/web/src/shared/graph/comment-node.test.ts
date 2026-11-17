import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GraphComment } from '@ugula/graph';
import { ReactFlowProvider } from '@xyflow/react';
import { createElement, useState } from 'react';
import { render, screen, userEvent, within } from '../testing-dom.ts';
import { CommentActions, CommentNode } from './comment-node.tsx';

const pricing: GraphComment = {
  id: 'comment1',
  text: 'Pricing',
  position: { x: 0, y: 0 },
  size: { width: 300, height: 200 },
  color: 'info'
};

const props = {
  id: 'comment:comment1',
  type: 'comment' as const,
  dragging: false,
  zIndex: -2,
  isConnectable: false,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
  draggable: true,
  selectable: true,
  deletable: true
};

type Patch = Partial<Omit<GraphComment, 'id'>>;

const show = ({
  comment = pricing,
  editable = true,
  selected = true
}: {
  comment?: GraphComment;
  editable?: boolean;
  selected?: boolean;
} = {}) => {
  const updates: [string, Patch][] = [];
  const Host = () => {
    const [current, setCurrent] = useState(comment);
    return createElement(CommentActions, {
      value: editable
        ? (id: string, patch: Patch) => {
            updates.push([id, patch]);
            setCurrent((c) => ({ ...c, ...patch }));
          }
        : null,
      children: createElement(ReactFlowProvider, {
        children: createElement(CommentNode, { ...props, data: { comment: current }, selected })
      })
    });
  };
  render(createElement(Host));
  return { updates, user: userEvent.setup() };
};

const frame = (name: string) => screen.getByRole('region', { name });

describe('CommentNode', () => {
  it('names the frame by its text and tints it by its color', () => {
    show({ editable: false });
    assert.deepEqual(
      ['bg-info/10', 'border-info/30', 'text-info'].map((c) =>
        frame('Pricing').classList.contains(c)
      ),
      [true, true, true]
    );
  });

  it('tints a frame without a color as neutral', () => {
    const { color: _, ...plain } = pricing;
    show({ comment: plain, editable: false });
    assert.equal(frame('Pricing').classList.contains('bg-surface-fg/5'), true);
  });

  it('calls a frame without text a comment', () => {
    show({ comment: { ...pricing, text: '' }, editable: false });
    assert.ok(frame('Comment'));
  });

  it('rings the frame while it is selected', () => {
    show({ editable: false });
    assert.equal(frame('Pricing').classList.contains('ring-primary'), true);
  });

  it('shows only the title when read-only', () => {
    show({ editable: false });
    assert.ok(screen.getByRole('heading', { level: 3, name: 'Pricing' }));
    assert.ok(!screen.queryByRole('textbox'));
    assert.ok(!screen.queryByRole('radiogroup'));
  });

  it('edits the title inline', async () => {
    const { updates, user } = show({ selected: false });
    const title = screen.getByRole('textbox', { name: 'Comment Title' });
    assert.equal((title as HTMLInputElement).value, 'Pricing');
    await user.type(title, 's');
    assert.deepEqual(updates, [['comment1', { text: 'Pricings' }]]);
    assert.ok(frame('Pricings'));
  });

  it('offers the colors only while selected', () => {
    show({ selected: false });
    assert.ok(!screen.queryByRole('group', { name: 'Comment Color' }));
  });

  it('picks a color from the swatches', async () => {
    const { updates, user } = show();
    const colors = screen.getByRole('group', { name: 'Comment Color' });
    assert.deepEqual(
      within(colors)
        .getAllByRole('radio')
        .map((r) => [r.getAttribute('aria-label'), (r as HTMLInputElement).checked]),
      [
        ['Neutral', false],
        ['Primary', false],
        ['Info', true],
        ['Success', false],
        ['Warning', false],
        ['Danger', false]
      ]
    );
    await user.click(within(colors).getByRole('radio', { name: 'Warning' }));
    assert.deepEqual(updates, [['comment1', { color: 'warning' }]]);
    assert.equal(frame('Pricing').classList.contains('bg-warning/10'), true);
  });

  it('keeps the title input from starting a drag', () => {
    show();
    assert.equal(
      screen.getByRole('textbox', { name: 'Comment Title' }).classList.contains('nodrag'),
      true
    );
  });

  it('calls the frame a comment once its title is cleared', async () => {
    const { updates, user } = show();
    await user.clear(screen.getByRole('textbox', { name: 'Comment Title' }));
    assert.deepEqual(updates, [['comment1', { text: '' }]]);
    assert.ok(frame('Comment'));
  });
});
