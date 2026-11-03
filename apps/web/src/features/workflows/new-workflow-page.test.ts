import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WorkflowsClient } from './client.ts';
import { graphKindOf, NewWorkflowForm, NewWorkflowPage } from './new-workflow-page.tsx';

describe('NewWorkflowPage', () => {
  it('creates a workflow on its own page with Title Cased labels and a way back', () => {
    const html = renderToStaticMarkup(
      createElement(NewWorkflowForm, {
        kind: 'node',
        back: '/workflows?kind=blocks',
        onKindChange: () => undefined,
        onCreate: async () => null
      })
    );
    assert.ok(html.includes('billing.match-patient'));
    assert.ok(html.includes('aria-label="Create Subworkflow"'));
    assert.ok(html.includes('<option value="node" selected="">Subworkflow</option>'));
    assert.ok(
      html.includes('href="/workflows?kind=blocks"') && html.includes('Create Subworkflow')
    );
    assert.ok(html.includes('@3xl:grid-cols-4') && html.includes('type="submit"'));
    const page = renderToStaticMarkup(
      createElement(NewWorkflowPage, {
        client: {} as WorkflowsClient,
        kind: 'workflow',
        back: '/workflows'
      })
    );
    assert.ok(
      page.includes('>New Workflow</h1>') && page.includes('aria-label="Back to Workflows"')
    );
    assert.equal(graphKindOf(new URLSearchParams('kind=node')), 'node');
    assert.equal(graphKindOf(new URLSearchParams('kind=x')), 'workflow');
  });
});
