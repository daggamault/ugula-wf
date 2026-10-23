import { FileUpIcon, UploadIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { Page } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import type { ImportsClient } from './client.ts';

export type ImportsPageProps = {
  client: ImportsClient;
};

export const ImportsPage = ({ client }: ImportsPageProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      navigate(`/runs/${(await client.upload(file)).runId}`);
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  };

  return (
    <Page
      title="Imports"
      description="Upload a NEMSIS 3.5 export. Each patient care report becomes its own claim run."
    >
      <form onSubmit={submit} className="flex max-w-2xl flex-col gap-6">
        <SectionPanel
          title="NEMSIS File"
          description="Patient care reports are matched to patients and priced as claims."
        >
          <fieldset disabled={busy}>
            <label
              htmlFor="import-file"
              className="border-border bg-canvas hover:border-primary/50 has-focus-visible:border-primary flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-10 text-center transition duration-150 ease-out"
            >
              <span
                aria-hidden="true"
                className="bg-primary/10 text-primary grid size-12 place-items-center rounded-full"
              >
                <FileUpIcon className="size-6" />
              </span>
              <span className="text-sm font-semibold">
                {file ? file.name : 'Choose a NEMSIS XML file'}
              </span>
              <span className="text-surface-fg-muted text-xs">
                {file ? `${(file.size / 1024).toFixed(0)} KB` : 'XML exports only'}
              </span>
              <input
                id="import-file"
                type="file"
                accept=".xml,application/xml,text/xml"
                required
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="sr-only"
              />
            </label>
          </fieldset>
          {error ? <Alert>{error}</Alert> : null}
          <div>
            <Button
              type="submit"
              isPending={busy}
              disabledReason={file ? undefined : 'Choose a file first.'}
            >
              <UploadIcon aria-hidden="true" className="size-4" />
              Import
            </Button>
          </div>
        </SectionPanel>
      </form>
    </Page>
  );
};
