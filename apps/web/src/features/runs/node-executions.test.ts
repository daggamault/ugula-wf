import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NodeExecutions } from './node-executions.tsx';

describe('NodeExecutions', () => {
  it('lists executions newest first with values, pins and errors', () => {
    const html = renderToStaticMarkup(
      createElement(NodeExecutions, {
        title: 'Match patient',
        steps: [
          {
            seq: 3,
            path: '',
            node: 'm',
            node_type: 'x',
            event: 'exec',
            inputs: { mrn: '123' },
            outputs: {},
            pin: null,
            error: { message: 'Ambiguous match', path: '', node: 'm' },
            started_at: '2026-01-01T00:00:00Z',
            duration_ms: 3
          },
          {
            seq: 9,
            path: '',
            node: 'm',
            node_type: 'x',
            event: 'resume',
            inputs: {},
            outputs: { patientId: 'p1' },
            pin: 'matched',
            error: null,
            started_at: '2026-01-01T00:01:00Z',
            duration_ms: 1500
          }
        ]
      })
    );
    assert.ok(html.includes('2 executions'));
    assert.ok(html.indexOf('#9') < html.indexOf('#3'));
    assert.ok(html.includes('→ matched'));
    assert.ok(html.includes('Ambiguous match'));
    assert.ok(html.includes('&quot;patientId&quot;'));
    assert.ok(html.includes('1.5 s'));
  });

  it('opens the runs a node started from icon actions', () => {
    const html = renderToStaticMarkup(
      createElement(NodeExecutions, {
        title: 'X',
        steps: [],
        runs: [
          { id: 'r1', name: 'Process PCR', status: 'completed', parent_index: 0 },
          { id: 'r2' }
        ]
      })
    );
    assert.ok(html.includes('href="/runs/r1" aria-label="Open run #1 Process PCR"'));
    assert.ok(html.includes('href="/runs/r2" aria-label="Open run #2"'));
    assert.equal(html.split('href="/runs/r1"').length, 2);
  });

  it('says when a node has not run', () => {
    const html = renderToStaticMarkup(createElement(NodeExecutions, { title: 'X', steps: [] }));
    assert.ok(html.includes('Not executed yet'));
    assert.ok(!html.includes('Open Building Block'));
    const composite = renderToStaticMarkup(
      createElement(NodeExecutions, { title: 'X', steps: [], onOpen: () => undefined })
    );
    assert.ok(composite.includes('Open Building Block'));
  });
});
