import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Json } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import { act, render, screen, userEvent, waitFor } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import type { GraphScope, TableComparison, TableDetail, WorkflowsClient } from './client.ts';
import { TablePage, TableView, tablePath } from './table-page.tsx';

HTMLElement.prototype.showPopover ??= () => undefined;

const RATES: Json = {
  type: 'string',
  rows: [{ key: 'ALS1', value: 'A0427' }]
};

const BASE: Json = { type: 'string', rows: [{ key: 'ALS1', value: 'A0426' }] };

const detail = (scope: GraphScope, published: boolean, effectiveScope = scope): TableDetail => ({
  table: {
    id: 't1',
    scope,
    key: 'billing.codes',
    name: 'Codes',
    kind: 'lookup',
    description: '',
    overridden_by: null,
    overrides: scope === 'system' ? null : 't0',
    is_stale: false,
    canEdit: scope !== 'system',
    canOverride: scope === 'system',
    effectiveId: effectiveScope === scope ? 't1' : 't9',
    effectiveScope
  },
  versions: [
    {
      id: 'v1',
      version: 1,
      published_at: published ? '2026-01-01' : null,
      created_at: '2026-01-01',
      base_version: null,
      base_table_id: null
    }
  ]
});

const copiedFrom = (base: Json, baseChanged = false): TableComparison => ({
  mine: { version: 1, definition: RATES },
  copiedFrom: { version: 1, definition: base, scope: 'system' },
  latest: { version: baseChanged ? 2 : 1, definition: base },
  baseChanged
});

const staticView = (d: TableDetail, comparison: TableComparison | null = null) =>
  renderToStaticMarkup(
    createElement(TableView, {
      detail: d,
      version: 1,
      source: RATES,
      comparison,
      client: {} as WorkflowsClient,
      onSaved: () => undefined
    })
  );

const never = () => new Promise<never>(() => undefined);

const view = (
  d: TableDetail,
  tables: Partial<WorkflowsClient['tables']>,
  comparison: TableComparison | null = null
) => {
  const notes: ToastInput[] = [];
  let saved = 0;
  render(
    createElement(
      ToastProvider,
      { onNotify: (t) => notes.push(t) },
      createElement(TableView, {
        detail: d,
        version: 1,
        source: RATES,
        comparison,
        client: { tables } as unknown as WorkflowsClient,
        onSaved: () => {
          saved += 1;
        }
      })
    )
  );
  return { notes, saved: () => saved, user: userEvent.setup() };
};

const button = (name: string) => screen.getByRole('button', { name });

const isDisabled = (el: HTMLElement) => el.getAttribute('aria-disabled') === 'true';

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

const here = () => `${window.location.pathname}${window.location.search}`;

describe('TableView', () => {
  it('offers standard tables for overriding and opens the copy in effect', () => {
    const html = staticView(detail('system', true));
    assert.ok(html.includes('>Customize<'));
    assert.ok(html.includes('>Standard<') && html.includes('Standard tables are read-only'));
    assert.ok(html.includes('value="A0427"') && html.includes('disabled'));
    assert.ok(!html.includes('>Save<') && !html.includes('>Publish<'));
    const copied = staticView(detail('system', true, 'agency'));
    assert.ok(copied.includes('href="/tables/t9"') && copied.includes('Open Custom Copy'));
    assert.ok(copied.includes('Has Custom Copy') && !copied.includes('>Customize<'));
  });

  it('marks a draft copy that differs from its base and warns when the base moved', () => {
    const html = staticView(detail('agency', false), copiedFrom(BASE, true));
    assert.ok(html.includes('Draft v1') && html.includes('>Save<') && html.includes('>Publish<'));
    assert.ok(html.includes('Changed From Base') && html.includes('Reset to Base'));
    assert.ok(html.includes('Base Updated.') && html.includes('Remove Override'));
    const same = staticView(detail('agency', false), copiedFrom(RATES));
    assert.ok(!same.includes('Changed From Base') && !same.includes('Base Updated.'));
  });

  it('offers a new draft from a published copy that has none', () => {
    const html = staticView(detail('agency', true));
    assert.ok(html.includes('Edit as New Draft') && !html.includes('>Publish<'));
    assert.ok(html.includes('Edit as a new draft to make changes.'));
  });

  it('saves the edited rows as a draft and clears the unsaved mark', async () => {
    const calls: [string, Json][] = [];
    const { notes, saved, user } = view(detail('agency', false), {
      saveDraft: async (id, definition) => {
        calls.push([id, definition]);
        return { version: 1 };
      }
    });
    assert.ok(isDisabled(button('Save')));
    await user.clear(field('Value'));
    await user.type(field('Value'), 'A0429');
    assert.ok(screen.getByText('Unsaved'));
    assert.ok(isDisabled(button('Publish')));
    await user.click(button('Save'));
    assert.deepEqual(calls, [
      ['t1', { type: 'string', rows: [{ key: 'ALS1', value: 'A0429' }], fallback: null }]
    ]);
    assert.ok(!screen.queryByText('Unsaved'));
    assert.deepEqual(
      notes.map((n) => n.title),
      ['Draft v1 saved']
    );
    assert.equal(saved(), 1);
    assert.ok(!isDisabled(button('Publish')));
  });

  it('opens the new draft when saving a published copy makes one', async () => {
    const { user } = view(detail('agency', true), { saveDraft: async () => ({ version: 2 }) });
    await user.click(button('Edit as New Draft'));
    assert.equal(here(), '/tables/t1?version=2');
  });

  it('keeps the unsaved mark when the rows change while a save is in flight', async () => {
    let finish: (v: { version: number }) => void = () => undefined;
    const { user } = view(detail('agency', false), {
      saveDraft: () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    });
    await user.type(field('Key'), 'X');
    await user.click(button('Save'));
    assert.equal(button('Save').getAttribute('aria-busy'), 'true');
    assert.ok(isDisabled(button('Publish')));
    await user.type(field('Key'), 'Y');
    await act(async () => finish({ version: 1 }));
    assert.ok(screen.getByText('Unsaved'));
    assert.equal(field('Key').value, 'ALS1XY');
  });

  it('shows why a save failed and keeps the changes', async () => {
    const { notes, saved, user } = view(detail('agency', false), {
      saveDraft: async () => {
        throw new Error('Table rows are invalid');
      }
    });
    await user.type(field('Key'), 'X');
    await user.click(button('Save'));
    assert.equal((await screen.findByRole('alert')).textContent, 'Table rows are invalid');
    assert.ok(screen.getByText('Unsaved'));
    assert.equal(button('Save').getAttribute('aria-busy'), null);
    assert.deepEqual([notes, saved()], [[], 0]);
  });

  it('publishes a saved draft and clears an earlier error', async () => {
    const calls: string[] = [];
    const { notes, saved, user } = view(detail('agency', false), {
      publish: async (id) => {
        calls.push(id);
        if (calls.length === 1) throw new Error('Publishing is paused');
        return { version: 1 };
      }
    });
    await user.click(button('Publish'));
    assert.equal((await screen.findByRole('alert')).textContent, 'Publishing is paused');
    await user.click(button('Publish'));
    await waitFor(() => assert.ok(!screen.queryByRole('alert')));
    assert.deepEqual(calls, ['t1', 't1']);
    assert.deepEqual(
      notes.map((n) => n.title),
      ['Codes v1 published']
    );
    assert.equal(saved(), 1);
  });

  it('copies a standard table for the agency and opens the copy', async () => {
    const calls: string[] = [];
    const { notes, user } = view(detail('system', true), {
      override: async (id) => {
        calls.push(id);
        return { id: 't5' };
      }
    });
    await user.click(button('Customize'));
    assert.deepEqual(calls, ['t1']);
    assert.equal(here(), '/tables/t5');
    assert.deepEqual(
      notes.map((n) => n.title),
      ['Codes copied for this agency']
    );
  });

  it('removes an override only after confirming, then opens the standard table', async () => {
    const calls: string[] = [];
    const { user } = view(detail('agency', true), {
      remove: async (id) => {
        calls.push(id);
        return { id };
      }
    });
    await user.click(button('Remove Override'));
    await user.click(button('Keep'));
    assert.deepEqual(calls, []);
    await user.click(button('Remove Override'));
    const confirm = screen.getAllByRole('button', { name: 'Remove Override' }).at(-1);
    assert.ok(confirm);
    await user.click(confirm);
    assert.deepEqual(calls, ['t1']);
    assert.equal(here(), '/tables/t0');
  });

  it('resets a copy to the rows of its base', async () => {
    const calls: Json[] = [];
    const { user } = view(
      detail('agency', false),
      {
        saveDraft: async (_, definition) => {
          calls.push(definition);
          return { version: 1 };
        }
      },
      copiedFrom(BASE)
    );
    await user.click(button('Reset to Base'));
    assert.equal(field('Value').value, 'A0426');
    assert.ok(!screen.queryByText('Changed From Base'));
    assert.ok(!screen.queryByRole('button', { name: 'Reset to Base' }));
    await user.click(button('Save'));
    assert.deepEqual(calls, [BASE]);
  });

  it('opens another version from the version picker', async () => {
    const d = detail('agency', true);
    const [v1] = d.versions;
    assert.ok(v1);
    const { user } = view(
      { ...d, versions: [{ ...v1, id: 'v2', version: 2, published_at: null }, v1] },
      {}
    );
    await user.click(screen.getByRole('option', { name: 'v2 (Draft)' }));
    assert.equal(here(), '/tables/t1?version=2');
  });
});

describe('TablePage', () => {
  it('builds table paths', () => {
    assert.equal(tablePath('t1'), '/tables/t1');
    assert.equal(tablePath('t1', 2), '/tables/t1?version=2');
  });

  it('opens the draft when no version is asked for', async () => {
    const asked: number[] = [];
    render(
      createElement(TablePage, {
        client: {
          tables: {
            find: async () => detail('agency', false),
            compare: never,
            version: async (_: string, version: number) => {
              asked.push(version);
              return { id: 'v1', version, definition: RATES, published_at: null };
            }
          }
        } as unknown as WorkflowsClient,
        live: idleLive,
        tableId: 't1',
        version: null
      })
    );
    assert.ok(screen.getByLabelText('Loading'));
    assert.ok(await screen.findByRole('heading', { name: 'Codes', level: 1 }));
    assert.deepEqual(asked, [1]);
    assert.equal(here(), '/tables/t1?version=1');
    assert.equal(field('Value').value, 'A0427');
  });

  it('says why the table could not load', async () => {
    render(
      createElement(TablePage, {
        client: {
          tables: {
            find: async () => {
              throw new Error('Table not found');
            },
            compare: never,
            version: never
          }
        } as unknown as WorkflowsClient,
        live: idleLive,
        tableId: 't1',
        version: 1
      })
    );
    assert.ok(await screen.findByText('Table not found'));
  });
});
