import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ReactFlowProvider } from '@xyflow/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommentActions, CommentNode } from './comment-node.tsx';

const props = {
  id: 'comment:comment1',
  type: 'comment' as const,
  data: {
    comment: {
      id: 'comment1',
      text: 'Pricing',
      position: { x: 0, y: 0 },
      size: { width: 300, height: 200 },
      color: 'info' as const
    }
  },
  dragging: false,
  zIndex: -2,
  isConnectable: false,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
  draggable: true,
  selectable: true,
  deletable: true
};

const render = (editable: boolean, selected: boolean) =>
  renderToStaticMarkup(
    createElement(CommentActions, {
      value: editable ? () => undefined : null,
      children: createElement(ReactFlowProvider, {
        children: createElement(CommentNode, { ...props, selected })
      })
    })
  );

describe('CommentNode', () => {
  it('renders a tinted, titled frame that edits inline when selected', () => {
    const html = render(true, true);
    assert.ok(html.includes('aria-label="Pricing"'));
    assert.ok(html.includes('bg-info/10') && html.includes('border-info/30'));
    assert.ok(html.includes('aria-label="Comment Title"') && html.includes('value="Pricing"'));
    assert.ok(html.includes('Comment Color') && html.includes('type="radio"'));
  });

  it('shows only the title when read-only', () => {
    const html = render(false, true);
    assert.ok(html.includes('>Pricing</h3>'));
    assert.ok(!html.includes('<input') && !html.includes('Comment Color'));
  });
});
