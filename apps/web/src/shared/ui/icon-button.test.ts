import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PencilIcon, Trash2Icon } from 'lucide-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DeleteButton,
  EditLink,
  IconButton,
  IconLink,
  OpenLink,
  RemoveButton,
  RowActions,
  WorkLink
} from './icon-button.tsx';

describe('IconButton', () => {
  it('labels an icon-only button, shows its tooltip and tints danger actions', () => {
    const html = renderToStaticMarkup(
      createElement(IconButton, { label: 'Delete Fee', icon: Trash2Icon, intent: 'danger' })
    );
    assert.ok(html.includes('aria-label="Delete Fee"'));
    assert.ok(html.includes('type="button"'));
    assert.ok(html.includes('hover:text-danger'));
    assert.ok(html.includes('cursor-pointer') && html.includes('focus-visible:outline-primary'));
    assert.ok(html.includes('size-9') && html.includes('rounded-lg'));
    assert.match(html, /<svg[^>]*aria-hidden="true"/);
    assert.ok(html.includes('popover="manual"') && html.includes('>Delete Fee</span>'));
    assert.ok(!html.includes('aria-disabled=') && !html.includes('aria-describedby='));
  });

  it('stays focusable when blocked and explains why', () => {
    const html = renderToStaticMarkup(
      createElement(IconButton, { label: 'Move Up', icon: PencilIcon, disabledReason: 'First.' })
    );
    assert.ok(html.includes('aria-disabled="true"') && !html.includes('disabled=""'));
    const [, describedBy] = html.match(/aria-describedby="([^"]+)"/) ?? [];
    assert.ok(
      describedBy && html.includes(`<span id="${describedBy}" class="sr-only">First.</span>`)
    );
  });
});

describe('IconLink', () => {
  it('renders a labelled icon link', () => {
    const html = renderToStaticMarkup(
      createElement(IconLink, { to: '/runs', label: 'Back to Runs', icon: PencilIcon })
    );
    assert.ok(html.includes('href="/runs"'));
    assert.ok(html.includes('aria-label="Back to Runs"'));
    assert.ok(html.includes('cursor-pointer') && html.includes('>Back to Runs</span>'));
  });
});

describe('RemoveButton', () => {
  it('names what it removes under a Remove tooltip and can be blocked', () => {
    const html = renderToStaticMarkup(
      createElement(RemoveButton, { label: 'Remove Medicare', onClick: () => undefined })
    );
    assert.ok(html.includes('aria-label="Remove Medicare"') && html.includes('>Remove</span>'));
    assert.ok(html.includes('lucide-trash') && html.includes('hover:text-danger'));
    const blocked = renderToStaticMarkup(
      createElement(RemoveButton, {
        label: 'Remove Medicare',
        disabledReason: 'Closed.',
        onClick: () => undefined
      })
    );
    assert.ok(blocked.includes('aria-disabled="true"') && blocked.includes('>Closed.</span>'));
  });
});

describe('row actions', () => {
  it('names the row in each action label under a short tooltip', () => {
    const html = renderToStaticMarkup(
      createElement(
        RowActions,
        null,
        createElement(WorkLink, { to: '/tasks/t1', name: 'Doe, Jane' }),
        createElement(OpenLink, { to: '/claims/c1', name: 'Doe, Jane' }),
        createElement(EditLink, { to: '/fees/f1', name: 'A0427' }),
        createElement(DeleteButton, { name: 'A0427', onClick: () => undefined })
      )
    );
    assert.ok(html.startsWith('<span class="flex items-center justify-end gap-1">'));
    for (const [label, tooltip] of [
      ['Work Doe, Jane', 'Work Task'],
      ['Open Doe, Jane', 'Open'],
      ['Edit A0427', 'Edit'],
      ['Delete A0427', 'Delete']
    ] as const) {
      assert.ok(html.includes(`aria-label="${label}"`), label);
      assert.ok(html.includes(`>${tooltip}</span>`), tooltip);
    }
    assert.ok(html.includes('lucide-trash') && html.includes('hover:text-danger'));
  });
});
