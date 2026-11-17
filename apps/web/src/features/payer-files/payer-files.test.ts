import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { InboundKind } from '@ugula/billing';
import type { ToastInput } from '../../shared/ui/toast.tsx';
import type { PayerFilesClient } from './client.ts';
import { fileStatus, kindOf, uploadPayerFiles } from './payer-files.ts';

const scope = { agencyId: 'a-1', signal: new AbortController().signal };

const recordingClient = (
  kinds: Record<string, InboundKind>,
  fail: Record<string, Error> = {},
  onUpload?: () => void
) => {
  const uploads: [string, string | null][] = [];
  let run = 0;
  const client: Pick<PayerFilesClient, 'upload'> = {
    upload: async (file: File, agencyId: string | null) => {
      uploads.push([file.name, agencyId]);
      onUpload?.();
      const error = fail[file.name];
      if (error) throw error;
      run += 1;
      return { runIds: [`r${run}`], kind: kinds[file.name] ?? '835' };
    }
  };
  return { client, uploads };
};

const file = (name: string) => new File(['ISA'], name);

describe('kindOf', () => {
  it('names each kind of payer file', () => {
    assert.deepEqual(
      (['835', '999', '277', '271', 'TA1', '277S'] as const).map((kind) => kindOf({ kind })),
      [
        'Remittance (835)',
        'Acknowledgment (999)',
        'Claim acknowledgment (277CA)',
        'Eligibility response (271)',
        'Interchange acknowledgment (TA1)',
        'Claim status (277)'
      ]
    );
  });
});

describe('fileStatus', () => {
  it('says how many lines need a biller', () => {
    assert.deepEqual(fileStatus({ item_count: 3, problem_count: 1 }), {
      intent: 'warning',
      label: '1 of 3 needs you'
    });
    assert.deepEqual(fileStatus({ item_count: 3, problem_count: 2 }), {
      intent: 'warning',
      label: '2 of 3 need you'
    });
  });

  it('is applied when every line went through', () => {
    assert.deepEqual(fileStatus({ item_count: 3, problem_count: 0 }), {
      intent: 'success',
      label: 'All Applied'
    });
  });

  it('says when a file had no lines to apply', () => {
    assert.deepEqual(fileStatus({ item_count: 0, problem_count: 0 }), {
      intent: 'success',
      label: 'Nothing to Apply'
    });
  });
});

describe('uploadPayerFiles', () => {
  it('starts a run for each file into the agency and names what it applies', async () => {
    const { client, uploads } = recordingClient({ 'era.835': '835', 'ack.999': '999' });
    const toasts: ToastInput[] = [];
    const received = await uploadPayerFiles(
      client,
      (t) => void toasts.push(t),
      [file('era.835'), file('ack.999')],
      scope
    );
    assert.equal(received, 2);
    assert.deepEqual(uploads, [
      ['era.835', 'a-1'],
      ['ack.999', 'a-1']
    ]);
    assert.deepEqual(toasts, [
      {
        key: 'payer-file:era.835',
        intent: 'success',
        title: 'era.835 received',
        description:
          'The Remittance (835) is being applied to its claims; lines that need a biller become tasks.',
        action: { label: 'Open Run', to: '/runs/r1' }
      },
      {
        key: 'payer-file:ack.999',
        intent: 'success',
        title: 'ack.999 received',
        description:
          'The Acknowledgment (999) is being applied to its claims; lines that need a biller become tasks.',
        action: { label: 'Open Run', to: '/runs/r2' }
      }
    ]);
  });

  it('says why a file was refused and carries on with the rest', async () => {
    const { client, uploads } = recordingClient({}, { 'bad.txt': new Error('Not an X12 file') });
    const toasts: ToastInput[] = [];
    const received = await uploadPayerFiles(
      client,
      (t) => void toasts.push(t),
      [file('bad.txt'), file('era.835')],
      scope
    );
    assert.equal(received, 1);
    assert.deepEqual(uploads, [
      ['bad.txt', 'a-1'],
      ['era.835', 'a-1']
    ]);
    assert.deepEqual(toasts[0], {
      key: 'payer-file:bad.txt',
      intent: 'danger',
      title: 'bad.txt could not be applied',
      description: 'Not an X12 file'
    });
    assert.equal(toasts[1]?.title, 'era.835 received');
  });

  it('stops uploading once the page is gone', async () => {
    const stop = new AbortController();
    const { client, uploads } = recordingClient({}, {}, () => stop.abort());
    const toasts: ToastInput[] = [];
    const received = await uploadPayerFiles(
      client,
      (t) => void toasts.push(t),
      [file('a.835'), file('b.835')],
      { agencyId: 'a-1', signal: stop.signal }
    );
    assert.equal(received, 1);
    assert.deepEqual(uploads, [['a.835', 'a-1']]);
    assert.deepEqual(
      toasts.map((t) => t.title),
      ['a.835 received']
    );
  });

  it('uploads nothing and says nothing without files', async () => {
    const { client, uploads } = recordingClient({});
    const toasts: ToastInput[] = [];
    assert.equal(await uploadPayerFiles(client, (t) => void toasts.push(t), [], scope), 0);
    assert.deepEqual(uploads, []);
    assert.deepEqual(toasts, []);
  });
});
