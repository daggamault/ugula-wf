import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ToastInput } from '../../shared/ui/toast.tsx';
import type { ImportsClient } from './client.ts';
import { importFiles, isXmlFile } from './import-files.ts';

const file = (name: string, type = '') => new File(['<x/>'], name, { type });

const scope = { agencyId: 'a-1', signal: new AbortController().signal };

const RECEIVED = { runId: 'r1', file: { bucket: 'b', key: 'k', size: 1, contentType: 'x' } };

const recordingClient = (fail: Record<string, Error> = {}, onUpload?: () => void) => {
  const uploads: [string, string | null][] = [];
  const client: Pick<ImportsClient, 'upload'> = {
    upload: async (f: File, agencyId: string | null) => {
      uploads.push([f.name, agencyId]);
      onUpload?.();
      const error = fail[f.name];
      if (error) throw error;
      return RECEIVED;
    }
  };
  return { client, uploads };
};

const receivedToast = (name: string): ToastInput => ({
  key: `import:${name}`,
  title: `${name} received`,
  description:
    'Its reports are being read and matched. Tasks appear in your queues as they need you.',
  action: { label: 'View Imports', to: '/imports' }
});

describe('isXmlFile', () => {
  it('accepts files named .xml in any case', () => {
    assert.equal(isXmlFile(file('october.XML')), true);
    assert.equal(isXmlFile(file('october.xml')), true);
  });

  it('accepts XML media types whatever the name', () => {
    assert.equal(isXmlFile(file('export', 'application/xml')), true);
    assert.equal(isXmlFile(file('export', 'text/xml')), true);
    assert.equal(isXmlFile(file('export', 'application/nemsis+xml')), true);
  });

  it('refuses other files, including names that only contain xml', () => {
    assert.equal(isXmlFile(file('notes.pdf', 'application/pdf')), false);
    assert.equal(isXmlFile(file('october.xml.zip', 'application/zip')), false);
    assert.equal(isXmlFile(file('xml', 'text/plain')), false);
    assert.equal(isXmlFile(file('export', 'application/xmlish')), false);
  });
});

describe('importFiles', () => {
  it('uploads each XML file into the agency and says it was received', async () => {
    const { client, uploads } = recordingClient();
    const toasts: ToastInput[] = [];
    const received = await importFiles(
      client,
      (t) => toasts.push(t),
      [file('a.xml'), file('b.xml')],
      scope
    );
    assert.equal(received, 2);
    assert.deepEqual(uploads, [
      ['a.xml', 'a-1'],
      ['b.xml', 'a-1']
    ]);
    assert.deepEqual(toasts, [receivedToast('a.xml'), receivedToast('b.xml')]);
  });

  it('skips files that are not XML with a warning', async () => {
    const { client, uploads } = recordingClient();
    const toasts: ToastInput[] = [];
    const received = await importFiles(
      client,
      (t) => toasts.push(t),
      [file('scan.png', 'image/png'), file('a.xml')],
      scope
    );
    assert.equal(received, 1);
    assert.deepEqual(uploads, [['a.xml', 'a-1']]);
    assert.deepEqual(toasts, [
      {
        intent: 'warning',
        title: 'scan.png was not imported',
        description: 'Only NEMSIS XML exports can be imported.'
      },
      receivedToast('a.xml')
    ]);
  });

  it('says why a file could not be imported and carries on with the rest', async () => {
    const { client, uploads } = recordingClient({ 'bad.xml': new Error('The file is empty') });
    const toasts: ToastInput[] = [];
    const received = await importFiles(
      client,
      (t) => toasts.push(t),
      [file('bad.xml'), file('a.xml')],
      scope
    );
    assert.equal(received, 1);
    assert.deepEqual(uploads, [
      ['bad.xml', 'a-1'],
      ['a.xml', 'a-1']
    ]);
    assert.deepEqual(toasts, [
      {
        key: 'import:bad.xml',
        intent: 'danger',
        title: 'bad.xml could not be imported',
        description: 'The file is empty'
      },
      receivedToast('a.xml')
    ]);
  });

  it('uploads without an agency when none is chosen', async () => {
    const { client, uploads } = recordingClient();
    await importFiles(client, () => undefined, [file('a.xml')], {
      agencyId: null,
      signal: scope.signal
    });
    assert.deepEqual(uploads, [['a.xml', null]]);
  });

  it('stops importing once the page is gone', async () => {
    const stop = new AbortController();
    const { client, uploads } = recordingClient({}, () => {
      if (uploads.length === 2) stop.abort();
    });
    const toasts: ToastInput[] = [];
    const received = await importFiles(
      client,
      (t) => toasts.push(t),
      [file('a.xml'), file('b.xml'), file('c.xml')],
      { agencyId: 'a-1', signal: stop.signal }
    );
    assert.equal(received, 2);
    assert.deepEqual(uploads, [
      ['a.xml', 'a-1'],
      ['b.xml', 'a-1']
    ]);
    assert.deepEqual(toasts, [receivedToast('a.xml'), receivedToast('b.xml')]);
  });

  it('imports nothing when the page is already gone', async () => {
    const stop = new AbortController();
    stop.abort();
    const { client, uploads } = recordingClient();
    const toasts: ToastInput[] = [];
    const received = await importFiles(client, (t) => toasts.push(t), [file('a.xml')], {
      agencyId: 'a-1',
      signal: stop.signal
    });
    assert.equal(received, 0);
    assert.deepEqual(uploads, []);
    assert.deepEqual(toasts, []);
  });

  it('uploads nothing and says nothing without files', async () => {
    const { client, uploads } = recordingClient();
    const toasts: ToastInput[] = [];
    assert.equal(await importFiles(client, (t) => toasts.push(t), [], scope), 0);
    assert.deepEqual(uploads, []);
    assert.deepEqual(toasts, []);
  });
});
