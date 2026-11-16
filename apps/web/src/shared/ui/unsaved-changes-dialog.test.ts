import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UnsavedChangesDialog } from './unsaved-changes-dialog.tsx';

describe('UnsavedChangesDialog', () => {
  it('asks before discarding unsaved changes, closed until a navigation is held', () => {
    const html = renderToStaticMarkup(createElement(UnsavedChangesDialog));
    assert.ok(html.includes('>Discard Unsaved Changes?<') && !html.includes(' open=""'));
    assert.ok(html.includes('>Discard Changes<') && html.includes('>Keep Editing<'));
    assert.ok(html.includes('Leave anyway and lose them?') && html.includes('border-danger/30'));
  });
});
