import { PAYER_FILE_LABELS } from '@ugula/billing';
import { useCallback } from 'react';
import { messageOf } from '../../shared/api.ts';
import { type Notify, useToast } from '../../shared/ui/toast.tsx';
import type { PayerFileSummary, PayerFilesClient } from './client.ts';

export const kindOf = (f: Pick<PayerFileSummary, 'kind'>) => PAYER_FILE_LABELS[f.kind];

export const fileStatus = (f: Pick<PayerFileSummary, 'item_count' | 'problem_count'>) =>
  f.problem_count
    ? {
        intent: 'warning' as const,
        label: `${f.problem_count} of ${f.item_count} need${f.problem_count === 1 ? 's' : ''} you`
      }
    : { intent: 'success' as const, label: f.item_count ? 'All Applied' : 'Nothing to Apply' };

export const uploadPayerFiles = async (
  client: Pick<PayerFilesClient, 'upload'>,
  notify: Notify,
  files: readonly File[]
) => {
  let received = 0;
  for (const file of files) {
    try {
      const done = await client.upload(file);
      received += 1;
      notify({
        key: `payer-file:${file.name}`,
        intent: 'success',
        title: `${file.name} received`,
        description: `The ${PAYER_FILE_LABELS[done.kind]} is being applied to its claims; lines that need a biller become tasks.`,
        action: { label: 'Open Run', to: `/runs/${done.runId}` }
      });
    } catch (err) {
      notify({
        key: `payer-file:${file.name}`,
        intent: 'danger',
        title: `${file.name} could not be applied`,
        description: messageOf(err)
      });
    }
  }
  return received;
};

export const useUploadPayerFiles = (client: Pick<PayerFilesClient, 'upload'>) => {
  const notify = useToast();
  return useCallback(
    (files: readonly File[]) => uploadPayerFiles(client, notify, files),
    [client, notify]
  );
};
