import { useCallback } from 'react';
import { messageOf } from '../../shared/api.ts';
import { type Notify, useToast } from '../../shared/ui/toast.tsx';
import { type UploadScope, useUploadScope } from '../../shared/use-upload-scope.ts';
import type { ImportsClient } from './client.ts';

export const isXmlFile = (file: Pick<File, 'name' | 'type'>) =>
  /\.xml$/i.test(file.name) || /[/+]xml$/i.test(file.type);

export const importFiles = async (
  client: Pick<ImportsClient, 'upload'>,
  notify: Notify,
  files: readonly File[],
  { agencyId, signal }: UploadScope
) => {
  let received = 0;
  for (const file of files) {
    if (signal.aborted) break;
    if (!isXmlFile(file)) {
      notify({
        intent: 'warning',
        title: `${file.name} was not imported`,
        description: 'Only NEMSIS XML exports can be imported.'
      });
      continue;
    }
    try {
      const { importId } = await client.upload(file, agencyId);
      received += 1;
      notify({
        key: `import:${file.name}`,
        title: `${file.name} received`,
        description:
          'Its reports are being read into encounters, and each billable one into a claim for review.',
        action: { label: 'View Import', to: `/imports/${importId}` }
      });
    } catch (err) {
      notify({
        key: `import:${file.name}`,
        intent: 'danger',
        title: `${file.name} could not be imported`,
        description: messageOf(err)
      });
    }
  }
  return received;
};

export const useImportFiles = (client: Pick<ImportsClient, 'upload'>) => {
  const notify = useToast();
  const scope = useUploadScope();
  return useCallback(
    (files: readonly File[]) => importFiles(client, notify, files, scope()),
    [client, notify, scope]
  );
};
