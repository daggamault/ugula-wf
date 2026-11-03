import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ToastInput } from '../../shared/ui/toast.tsx';
import type { PayerFilesClient } from './client.ts';
import { fileStatus, kindOf, uploadPayerFiles } from './payer-files.ts';

describe('payer files', () => {
  it('names the kind and says how many lines need a biller', () => {
    assert.equal(kindOf({ kind: '277' }), 'Claim acknowledgment (277CA)');
    assert.deepEqual(fileStatus({ item_count: 3, problem_count: 1 }), {
      intent: 'warning',
      label: '1 of 3 needs you'
    });
    assert.equal(fileStatus({ item_count: 3, problem_count: 0 }).label, 'All Applied');
    assert.equal(fileStatus({ item_count: 0, problem_count: 0 }).label, 'Nothing to Apply');
  });

  it('uploads each file and reports what it did, or why it failed', async () => {
    const toasts: ToastInput[] = [];
    const client = {
      upload: async (file: File) => {
        if (file.name === 'bad.txt') throw new Error('Not an X12 file');
        return { id: 'f1', kind: '835', items: 4, problems: 1 };
      }
    } as unknown as Pick<PayerFilesClient, 'upload'>;
    const received = await uploadPayerFiles(client, (t) => void toasts.push(t), [
      new File(['ISA'], 'era.835'),
      new File(['x'], 'bad.txt')
    ]);
    assert.equal(received, 1);
    assert.deepEqual(
      toasts.map((t) => [t.intent, t.title, t.description]),
      [
        ['warning', 'era.835 applied', '1 of 4 lines need a biller.'],
        ['danger', 'bad.txt could not be applied', 'Not an X12 file']
      ]
    );
    assert.deepEqual(toasts[0]?.action, { label: 'Open File', to: '/payer-files/f1' });
  });
});

describe('uploadPayerFiles', () => {
  it('confirms a file that applied cleanly', async () => {
    const toasts: ToastInput[] = [];
    const client = {
      upload: async () => ({ id: 'f2', kind: '999', items: 2, problems: 0 })
    } as unknown as Pick<PayerFilesClient, 'upload'>;
    assert.equal(
      await uploadPayerFiles(client, (t) => void toasts.push(t), [new File(['ISA'], 'ack.999')]),
      1
    );
    assert.deepEqual(
      toasts.map((t) => [t.intent, t.title, t.description]),
      [['success', 'ack.999 applied', 'All 2 lines were applied to their claims.']]
    );
  });
});
