import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { act, render, waitFor } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import type { ImportsClient } from './client.ts';
import { carriesFiles, ImportDrop } from './import-drop.tsx';

const drag = (type: string, types: string[], files: File[] = []) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types, files } });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
};

const uploadingTo = (uploads: string[]): Pick<ImportsClient, 'upload'> => ({
  upload: async (file) => {
    uploads.push(file.name);
    return { runId: 'r', file: { bucket: 'b', key: 'k', size: 1, contentType: 'text/xml' } };
  }
});

const show = (uploads: string[] = [], toasts: ToastInput[] = []) => {
  const client = uploadingTo(uploads);
  const view = render(
    createElement(
      ToastProvider,
      { onNotify: (t) => toasts.push(t) },
      createElement(ImportDrop, { client })
    )
  );
  const overlay = view.container.querySelector('[aria-hidden="true"]');
  assert.ok(overlay);
  return overlay;
};

describe('carriesFiles', () => {
  it('reacts only to drags that carry files', () => {
    assert.equal(
      carriesFiles({ dataTransfer: { types: ['Files'] } as unknown as DataTransfer }),
      true
    );
    assert.equal(
      carriesFiles({ dataTransfer: { types: ['text/plain'] } as unknown as DataTransfer }),
      false
    );
    assert.equal(carriesFiles({ dataTransfer: null }), false);
  });
});

describe('ImportDrop', () => {
  it('stays hidden and inert until files are dragged over the window', () => {
    const overlay = show();
    assert.equal(overlay.hasAttribute('data-visible'), false);
    assert.equal(overlay.hasAttribute('inert'), true);
    assert.ok(overlay.textContent?.includes('Drop NEMSIS Files to Import'));
    drag('dragenter', ['text/plain']);
    assert.equal(overlay.hasAttribute('data-visible'), false);
    assert.equal(drag('dragover', ['text/plain']).defaultPrevented, false);
  });

  it('shows the overlay while files are over the window, through nested drag targets', () => {
    const overlay = show();
    assert.equal(drag('dragenter', ['Files']).defaultPrevented, true);
    assert.equal(drag('dragover', ['Files']).defaultPrevented, true);
    assert.equal(overlay.getAttribute('data-visible'), 'true');
    drag('dragenter', ['Files']);
    drag('dragleave', ['Files']);
    assert.equal(overlay.getAttribute('data-visible'), 'true');
    drag('dragleave', ['Files']);
    assert.equal(overlay.hasAttribute('data-visible'), false);
  });

  it('imports the dropped files and hides the overlay', async () => {
    const uploads: string[] = [];
    const toasts: ToastInput[] = [];
    const overlay = show(uploads, toasts);
    drag('dragenter', ['Files']);
    drag('dragenter', ['Files']);
    const files = [new File(['<x/>'], 'a.xml'), new File(['x'], 'scan.png')];
    assert.equal(drag('drop', ['Files'], files).defaultPrevented, true);
    assert.equal(overlay.hasAttribute('data-visible'), false);
    await waitFor(() => assert.equal(toasts.length, 2));
    assert.deepEqual(uploads, ['a.xml']);
    assert.deepEqual(
      toasts.map((t) => t.title),
      ['a.xml received', 'scan.png was not imported']
    );
    drag('dragenter', ['Files']);
    assert.equal(overlay.getAttribute('data-visible'), 'true');
  });

  it('stops listening once it is gone', () => {
    const uploads: string[] = [];
    const view = render(createElement(ImportDrop, { client: uploadingTo(uploads) }));
    view.unmount();
    assert.equal(drag('drop', ['Files'], [new File(['<x/>'], 'a.xml')]).defaultPrevented, false);
    assert.deepEqual(uploads, []);
  });
});
