import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ToastInput } from '../../shared/ui/toast.tsx';
import { importFiles, isXmlFile } from './import-files.ts';

const file = (name: string, type = '') => new File(['<x/>'], name, { type });

const scope = { agencyId: 'a-1', signal: new AbortController().signal };

describe('isXmlFile', () => {
  it('accepts XML exports by extension or media type', () => {
    assert.equal(isXmlFile(file('october.XML')), true);
    assert.equal(isXmlFile(file('export', 'application/xml')), true);
    assert.equal(isXmlFile(file('export', 'application/nemsis+xml')), true);
    assert.equal(isXmlFile(file('notes.pdf', 'application/pdf')), false);
  });
});

describe('importFiles', () => {
  it('uploads each XML file and says what happened to every file', async () => {
    const uploaded: string[] = [];
    const toasts: ToastInput[] = [];
    const received = await importFiles(
      {
        upload: async (f: File) => {
          if (f.name === 'bad.xml') throw new Error('The file is empty');
          uploaded.push(f.name);
          return { runId: 'r1', file: { bucket: 'b', key: 'k', size: 1, contentType: 'x' } };
        }
      },
      (t) => toasts.push(t),
      [file('a.xml'), file('scan.png', 'image/png'), file('bad.xml')],
      scope
    );
    assert.equal(received, 1);
    assert.deepEqual(uploaded, ['a.xml']);
    assert.deepEqual(
      toasts.map((t) => [t.intent ?? 'success', t.title, t.description]),
      [
        [
          'success',
          'a.xml received',
          'Its reports are being read and matched. Tasks appear in your queues as they need you.'
        ],
        ['warning', 'scan.png was not imported', 'Only NEMSIS XML exports can be imported.'],
        ['danger', 'bad.xml could not be imported', 'The file is empty']
      ]
    );
    assert.deepEqual(toasts[0]?.action, { label: 'View Imports', to: '/imports' });
  });
});

describe('importFiles across an agency switch or unmount', () => {
  it('imports every file into the agency it started in and stops once the page is gone', async () => {
    const stop = new AbortController();
    const agencies: (string | null)[] = [];
    await importFiles(
      {
        upload: async (_f: File, agencyId: string | null) => {
          agencies.push(agencyId);
          if (agencies.length === 2) stop.abort();
          return { runId: 'r1', file: { bucket: 'b', key: 'k', size: 1, contentType: 'x' } };
        }
      },
      () => undefined,
      [file('a.xml'), file('b.xml'), file('c.xml')],
      { agencyId: 'a-1', signal: stop.signal }
    );
    assert.deepEqual(agencies, ['a-1', 'a-1']);
  });
});

describe('importFiles without files', () => {
  it('uploads nothing and says nothing', async () => {
    const toasts: ToastInput[] = [];
    const received = await importFiles(
      { upload: () => Promise.reject(new Error('unreachable')) },
      (t) => toasts.push(t),
      [],
      scope
    );
    assert.equal(received, 0);
    assert.deepEqual(toasts, []);
  });
});
