import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WorkflowsClient } from './client.ts';
import { NewWorkflowDialog } from './new-workflow-dialog.tsx';

describe('NewWorkflowDialog', () => {
  it('renders the create form with key guidance and kind choices', () => {
    const html = renderToStaticMarkup(
      createElement(NewWorkflowDialog, {
        client: {} as WorkflowsClient,
        open: true,
        onClose: () => undefined
      })
    );
    assert.ok(html.includes('New Graph'));
    assert.ok(html.includes('billing.match-patient'));
    assert.ok(html.includes('<option value="node">Custom node</option>'));
    assert.ok(html.includes('type="submit"'));
  });
});
