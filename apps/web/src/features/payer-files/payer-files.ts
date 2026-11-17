import { PAYER_FILE_KINDS, PAYER_FILE_LABELS } from '@ugula/billing';
import { useCallback } from 'react';
import { messageOf } from '../../shared/api.ts';
import type { ColumnFilter } from '../../shared/ui/column-filters.tsx';
import { type Notify, useToast } from '../../shared/ui/toast.tsx';
import { type UploadScope, useUploadScope } from '../../shared/use-upload-scope.ts';
import type { PayerFileSummary, PayerFilesClient } from './client.ts';

export const kindOf = (f: Pick<PayerFileSummary, 'kind'>) => PAYER_FILE_LABELS[f.kind];

const OUTCOME_LABELS = {
  review: 'Needs You',
  applied: 'All Applied',
  empty: 'Nothing to Apply'
} as const;

export const PAYER_FILE_FILTERS: readonly ColumnFilter[] = [
  {
    key: 'kind',
    label: 'Kind',
    labelOf: (o) => {
      const kind = PAYER_FILE_KINDS.find((k) => k === o.value);
      return kind ? kindOf({ kind }) : o.value;
    }
  },
  {
    key: 'outcome',
    label: 'Outcome',
    labelOf: (o) => Object.entries(OUTCOME_LABELS).find(([k]) => k === o.value)?.[1] ?? o.value
  }
];

export const fileStatus = (f: Pick<PayerFileSummary, 'item_count' | 'problem_count'>) =>
  f.problem_count
    ? {
        intent: 'warning' as const,
        label: `${f.problem_count} of ${f.item_count} need${f.problem_count === 1 ? 's' : ''} you`
      }
    : {
        intent: 'success' as const,
        label: f.item_count ? OUTCOME_LABELS.applied : OUTCOME_LABELS.empty
      };

export const uploadPayerFiles = async (
  client: Pick<PayerFilesClient, 'upload'>,
  notify: Notify,
  files: readonly File[],
  { agencyId, signal }: UploadScope
) => {
  let received = 0;
  for (const file of files) {
    if (signal.aborted) break;
    try {
      const done = await client.upload(file, agencyId);
      received += 1;
      notify({
        key: `payer-file:${file.name}`,
        intent: 'success',
        title: `${file.name} received`,
        description: `The ${PAYER_FILE_LABELS[done.kind]} is being applied to its claims; lines that need a biller become tasks.`,
        ...(done.runIds[0] ? { action: { label: 'Open Run', to: `/runs/${done.runIds[0]}` } } : {})
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
  const scope = useUploadScope();
  return useCallback(
    (files: readonly File[]) => uploadPayerFiles(client, notify, files, scope()),
    [client, notify, scope]
  );
};
