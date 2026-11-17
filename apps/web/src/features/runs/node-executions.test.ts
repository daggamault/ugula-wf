import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent, within } from '../../shared/testing-dom.ts';
import type { RunStep } from './client.ts';
import { NodeExecutions } from './node-executions.tsx';

const step = (patch: Partial<RunStep>): RunStep => ({
  seq: 1,
  path: '',
  node: 'm',
  node_type: 'x',
  event: 'exec',
  inputs: {},
  outputs: {},
  pin: null,
  error: null,
  started_at: '2026-01-01T00:00:00Z',
  duration_ms: 3,
  ...patch
});

const failed = step({
  seq: 3,
  inputs: { mrn: '123' },
  error: { message: 'Ambiguous match', path: '', node: 'm' }
});

const resumed = step({
  seq: 9,
  event: 'resume',
  outputs: { patientId: 'p1' },
  pin: 'matched',
  started_at: '2026-01-01T00:01:00Z',
  duration_ms: 1500
});

const show = (props: Partial<Parameters<typeof NodeExecutions>[0]> = {}) =>
  render(createElement(NodeExecutions, { title: 'Match patient', steps: [], ...props }));

const json = (item: HTMLElement, label: string) =>
  within(item).queryByText(label)?.closest('figure')?.querySelector('pre')?.textContent ?? null;

const executions = () =>
  within(screen.getByRole('region', { name: 'Match patient' })).queryAllByRole('listitem');

describe('NodeExecutions', () => {
  it('counts the executions on this path', () => {
    show({ steps: [failed, resumed] });
    assert.ok(screen.getByText('It ran 2 times on this path, newest first.'));
  });

  it('says a single execution in the singular', () => {
    show({ steps: [failed] });
    assert.ok(screen.getByText('It ran 1 time on this path, newest first.'));
  });

  it('lists executions newest first with their event, pin, start and duration', () => {
    show({ steps: [failed, resumed] });
    const [newest, oldest] = executions();
    assert.ok(newest && oldest);
    assert.equal(within(newest).getByText('#9').textContent, '#9');
    assert.ok(within(newest).getByText('resume'));
    assert.ok(within(newest).getByText('→ matched'));
    assert.ok(within(newest).getByText('1.5 s'));
    assert.equal(newest.querySelector('time')?.getAttribute('datetime'), '2026-01-01T00:01:00Z');
    assert.ok(within(oldest).getByText('#3'));
    assert.ok(within(oldest).getByText('3 ms'));
    assert.ok(!within(oldest).queryByText(/^→/));
  });

  it('shows the error of a failed execution', () => {
    show({ steps: [failed, resumed] });
    const [newest, oldest] = executions();
    assert.ok(newest && oldest);
    assert.equal(within(oldest).getByRole('alert').textContent, 'Ambiguous match');
    assert.ok(!within(newest).queryByRole('alert'));
  });

  it('shows only the inputs and outputs an execution had', () => {
    show({ steps: [failed, resumed] });
    const [newest, oldest] = executions();
    assert.ok(newest && oldest);
    assert.equal(json(oldest, 'Inputs'), '{\n  "mrn": "123"\n}');
    assert.equal(json(oldest, 'Outputs'), null);
    assert.equal(json(newest, 'Outputs'), '{\n  "patientId": "p1"\n}');
    assert.equal(json(newest, 'Inputs'), null);
  });

  it('says when a node has not run', () => {
    show();
    assert.ok(screen.getByText('This node has not run on this path.'));
    assert.deepEqual(executions(), []);
  });

  it('offers no subworkflow for a plain node', () => {
    show();
    assert.ok(!screen.queryByRole('button', { name: 'Open Subworkflow' }));
  });

  it('opens the subworkflow of a composite node', async () => {
    let opened = 0;
    show({ onOpen: () => opened++ });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open Subworkflow' }));
    assert.equal(opened, 1);
  });

  it('links to the runs a node started, numbered by their place in the parent', () => {
    show({
      runs: [{ id: 'r1', name: 'Process PCR', status: 'completed', parent_index: 4 }, { id: 'r2' }]
    });
    const items = within(screen.getByRole('region', { name: 'Started Runs' })).getAllByRole(
      'listitem'
    );
    assert.deepEqual(
      items.map((li) => li.querySelector('span')?.textContent),
      ['#5 Process PCR', '#2']
    );
    assert.ok(within(items[0] as HTMLElement).getByText('Completed'));
    assert.equal(
      screen.getByRole('link', { name: 'Open run #5 Process PCR' }).getAttribute('href'),
      '/runs/r1'
    );
    assert.equal(
      screen.getByRole('link', { name: 'Open run #2' }).getAttribute('href'),
      '/runs/r2'
    );
  });

  it('leaves out started runs when the node started none', () => {
    show();
    assert.ok(!screen.queryByRole('region', { name: 'Started Runs' }));
  });
});
