import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Trash2Icon } from 'lucide-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfirmDialog, DeleteDialog, Dialog } from './dialog.tsx';

describe('Dialog', () => {
  it('renders a labelled native dialog', () => {
    const html = renderToStaticMarkup(
      createElement(Dialog, {
        open: true,
        title: 'New workflow',
        onClose: () => undefined,
        children: 'Body'
      })
    );
    assert.ok(html.startsWith('<dialog'));
    assert.match(html, /aria-labelledby="([^"]+)".*<h2 id="\1"/);
    assert.ok(html.includes('New workflow'));
    assert.ok(html.includes('Body'));
    assert.ok(html.includes('rounded-xl') && html.includes('shadow-lg'));
    assert.ok(html.includes('duration-200') && html.includes('starting:open:opacity-0'));
  });
});

describe('ConfirmDialog', () => {
  it('asks to confirm with a dismiss and an intent-colored confirm action', () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        open: true,
        title: 'Delete Fee?',
        intent: 'danger',
        confirmLabel: 'Delete',
        confirmIcon: Trash2Icon,
        dismissLabel: 'Keep',
        onConfirm: () => undefined,
        onClose: () => undefined,
        children: 'Claims will no longer be priced.'
      })
    );
    assert.ok(html.includes('Claims will no longer be priced.'));
    assert.ok(html.includes('>Keep</span>'));
    assert.ok(html.includes('>Delete</span>'));
    assert.ok(html.includes('bg-danger'));
    assert.ok(html.includes('border-danger/50') && html.includes('lucide-triangle-alert'));
  });
});

describe('DeleteDialog', () => {
  it('asks whether to delete the named thing, says it is permanent and what else changes', () => {
    const html = renderToStaticMarkup(
      createElement(DeleteDialog, {
        open: true,
        name: 'Medicare',
        onConfirm: () => undefined,
        onClose: () => undefined,
        children: 'Its prices are removed.'
      })
    );
    assert.ok(html.includes('>Delete Medicare?</h2>'));
    assert.ok(html.includes('Are you sure you want to delete <strong'));
    assert.ok(html.includes('This cannot be undone.') && html.includes('Its prices are removed.'));
    assert.ok(html.includes('>Keep</span>') && html.includes('>Delete</span>'));
    assert.ok(html.includes('border-danger/50'));
  });
});
