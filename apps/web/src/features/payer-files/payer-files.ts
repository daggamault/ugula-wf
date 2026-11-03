import { PAYER_FILE_LABELS, type PayerFileOutcome } from '@ugula/billing';
import { useCallback } from 'react';
import { messageOf } from '../../shared/api.ts';
import type { StatusBadgeStyle } from '../../shared/ui/badge.tsx';
import { type Notify, useToast } from '../../shared/ui/toast.tsx';
import type { PayerFileSummary, PayerFilesClient } from './client.ts';

export const OUTCOME_STYLES: Readonly<Record<PayerFileOutcome, StatusBadgeStyle>> = {
  posted: { intent: 'success', label: 'Posted' },
  accepted: { intent: 'success', label: 'Accepted' },
  eligible: { intent: 'success', label: 'Eligible' },
  duplicate: { label: 'Already Posted' },
  rejected: { intent: 'danger', label: 'Rejected' },
  ineligible: { intent: 'danger', label: 'Not Eligible' },
  unmatched: { intent: 'warning', label: 'No Match' },
  review: { intent: 'warning', label: 'Needs Review' }
};

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
        intent: done.problems ? 'warning' : 'success',
        title: `${file.name} applied`,
        description: done.problems
          ? `${done.problems} of ${done.items} lines need a biller.`
          : `All ${done.items} lines were applied to their claims.`,
        action: { label: 'Open File', to: `/payer-files/${done.id}` }
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
