import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef } from '@ugula/graph';
import { createElement } from 'react';
import { render, screen, userEvent } from '../../shared/testing-dom.ts';
import type { GraphComparison } from './client.ts';
import { ComparePanel } from './compare-panel.tsx';

HTMLElement.prototype.showPopover ??= () => undefined;

const then: GraphDef = {
  signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1 }],
  edges: []
};

const now: GraphDef = {
  ...then,
  nodes: [...then.nodes, { id: 'rate', type: 'std.math.add', version: 1 }]
};

const mine: GraphDef = {
  ...then,
  nodes: [...then.nodes, { id: 'fee', type: 'std.math.add', version: 1, label: 'County Fee' }]
};

const comparison: GraphComparison = {
  mine: { version: 2, definition: mine },
  copiedFrom: { version: 1, definition: then, scope: 'system' },
  latest: { version: 2, definition: now },
  baseChanged: true
};

const show = (
  props: Partial<Parameters<typeof ComparePanel>[0]> = {},
  compared: Partial<GraphComparison> = {}
) => {
  const calls: string[] = [];
  render(
    createElement(ComparePanel, {
      comparison: { ...comparison, ...compared },
      current: mine,
      noun: 'subworkflow',
      titleOf: (n) => n.label ?? n.id,
      canEdit: true,
      busy: false,
      onKeep: () => void calls.push('keep'),
      onReset: () => void calls.push('reset'),
      onClose: () => void calls.push('close'),
      ...props
    })
  );
  return { calls, user: userEvent.setup() };
};

const section = (title: string) =>
  screen.getByRole('heading', { name: title }).closest('section')?.textContent ?? '';

describe('ComparePanel', () => {
  it('lists the base then, what the base changed since and what you changed', () => {
    show();
    assert.match(section('Base Then'), /standard subworkflow v1, which this copy started from/);
    assert.match(section('Base Then'), /1 nodes/);
    assert.match(section('Base Now'), /v2, what runs use when there is no copy/);
    assert.match(section('Base Now'), /Added rate/);
    assert.match(section('Yours'), /Added County Fee/);
  });

  it('keeps your changes on the new base, starts again from it, or closes', async () => {
    const { calls, user } = show();
    await user.click(screen.getByRole('button', { name: 'Keep Mine' }));
    await user.click(screen.getByRole('button', { name: 'Start From Base' }));
    await user.click(screen.getByRole('button', { name: 'Close Compare' }));
    assert.deepEqual(calls, ['keep', 'reset', 'close']);
  });

  it('does not keep twice while bringing the copy up to date', async () => {
    const { calls, user } = show({ busy: true });
    await user.click(screen.getByRole('button', { name: 'Keep Mine' }));
    assert.deepEqual(calls, []);
  });

  it('says when the base is unchanged and hides the actions from readers', () => {
    show({ canEdit: false }, { baseChanged: false });
    assert.match(section('Base Now'), /The base has not changed since you copied it./);
    assert.ok(!screen.queryByRole('button', { name: 'Keep Mine' }));
  });

  it('explains a copy with no recorded or published base', () => {
    show({ current: then }, { copiedFrom: null, latest: null });
    assert.match(section('Base Then'), /does not record the version it started from.Unknown/);
    assert.match(section('Base Now'), /There is no published base./);
    assert.ok(!screen.queryByRole('button', { name: 'Keep Mine' }));
  });
});
