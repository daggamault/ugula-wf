import {
  AFTER_DOWNLOAD,
  type AfterDownload,
  CLEARINGHOUSE_VENDORS,
  type ClearinghouseVendor,
  VENDOR_PRESETS
} from '@ugula/billing';
import { SaveIcon, Trash2Icon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { ConfirmDialog } from '../../shared/ui/dialog.tsx';
import {
  FieldGrid,
  FieldGroup,
  FieldGroups,
  type FieldSpan,
  FormActions
} from '../../shared/ui/field.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import type { ClearinghouseConnection, ConnectionInput } from './client.ts';

type ConnectionText =
  | 'sftpHost'
  | 'sftpPort'
  | 'sftpHostKey'
  | 'sftpUsername'
  | 'secret'
  | 'uploadPath'
  | 'downloadPaths'
  | 'claimExtension'
  | 'eligibilityExtension'
  | 'claimStatusExtension'
  | 'realtimeUrl';

export type ConnectionDraft = Record<ConnectionText, string> & {
  vendor: ClearinghouseVendor;
  enabled: 'on' | 'off';
  afterDownload: AfterDownload;
};

const presetDraft = (vendor: ClearinghouseVendor) => {
  const p = VENDOR_PRESETS[vendor];
  return {
    vendor,
    sftpHost: p.host,
    sftpPort: String(p.port),
    sftpHostKey: p.hostKey ?? '',
    uploadPath: p.uploadPath,
    downloadPaths: p.downloadPaths.join(', '),
    claimExtension: p.extensions.claims,
    eligibilityExtension: p.extensions.eligibility,
    claimStatusExtension: p.extensions.claimStatus,
    afterDownload: p.afterDownload,
    realtimeUrl: p.realtimeUrl ?? ''
  };
};

export const toConnectionDraft = (c: ClearinghouseConnection | null): ConnectionDraft =>
  c
    ? {
        vendor: c.vendor,
        enabled: c.enabled ? 'on' : 'off',
        sftpHost: c.sftp_host,
        sftpPort: String(c.sftp_port),
        sftpHostKey: c.sftp_host_key,
        sftpUsername: c.sftp_username,
        secret: '',
        uploadPath: c.upload_path,
        downloadPaths: c.download_paths.join(', '),
        claimExtension: c.claim_extension,
        eligibilityExtension: c.eligibility_extension,
        claimStatusExtension: c.claim_status_extension,
        afterDownload: c.after_download,
        realtimeUrl: c.realtime_url ?? ''
      }
    : { ...presetDraft('waystar'), enabled: 'on', sftpUsername: '', secret: '' };

export const withVendor = (d: ConnectionDraft, vendor: ClearinghouseVendor): ConnectionDraft => ({
  ...d,
  ...presetDraft(vendor)
});

export const fromConnectionDraft = (d: ConnectionDraft): ConnectionInput => ({
  vendor: d.vendor,
  enabled: d.enabled === 'on',
  sftpHost: d.sftpHost.trim(),
  sftpPort: Number(d.sftpPort),
  sftpHostKey: d.sftpHostKey.trim(),
  sftpUsername: d.sftpUsername.trim(),
  secret: d.secret === '' ? null : d.secret,
  uploadPath: d.uploadPath.trim(),
  downloadPaths: d.downloadPaths
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean),
  claimExtension: d.claimExtension.trim(),
  eligibilityExtension: d.eligibilityExtension.trim(),
  claimStatusExtension: d.claimStatusExtension.trim(),
  afterDownload: d.afterDownload,
  realtimeUrl: d.realtimeUrl.trim() || null
});

type TextField = {
  key: ConnectionText;
  label: string;
  hint?: string;
  span?: FieldSpan;
  type?: string;
  required?: boolean;
};

const SFTP_FIELDS: TextField[] = [
  { key: 'sftpHost', label: 'SFTP Host', span: 2, required: true },
  { key: 'sftpPort', label: 'Port', type: 'number', required: true },
  { key: 'sftpUsername', label: 'Username', required: true },
  {
    key: 'sftpHostKey',
    label: 'Host Key',
    hint: 'The SHA256 fingerprint your clearinghouse gives you, like SHA256:…',
    span: 4,
    required: true
  }
];

const FOLDER_FIELDS: TextField[] = [
  { key: 'uploadPath', label: 'Upload Folder', span: 2, required: true },
  {
    key: 'downloadPaths',
    label: 'Download Folders',
    hint: 'Separate folders with commas',
    span: 2,
    required: true
  },
  { key: 'claimExtension', label: '837P Extension', hint: 'Claims, like .CLP', required: true },
  {
    key: 'eligibilityExtension',
    label: '270 Extension',
    hint: 'Batch eligibility, like .ELG',
    required: true
  },
  {
    key: 'claimStatusExtension',
    label: '276 Extension',
    hint: 'Batch claim status, like .CLS',
    required: true
  }
];

const VENDOR_OPTIONS = CLEARINGHOUSE_VENDORS.map((v) => ({
  value: v,
  label: VENDOR_PRESETS[v].label
}));

const ENABLED_OPTIONS = [
  { value: 'on', label: 'Exchange Files' },
  { value: 'off', label: 'Paused' }
];

const AFTER_DOWNLOAD_LABELS: Record<AfterDownload, string> = {
  delete: 'Delete From the Server',
  keep: 'Keep on the Server'
};

const AFTER_DOWNLOAD_OPTIONS = AFTER_DOWNLOAD.map((a) => ({
  value: a,
  label: AFTER_DOWNLOAD_LABELS[a]
}));

const isVendor = (x: string): x is ClearinghouseVendor =>
  (CLEARINGHOUSE_VENDORS as readonly string[]).includes(x);

export const endpointChanged = (c: ClearinghouseConnection, d: ConnectionDraft) =>
  c.sftp_host !== d.sftpHost.trim() ||
  c.sftp_port !== Number(d.sftpPort) ||
  c.sftp_host_key !== d.sftpHostKey.trim() ||
  c.sftp_username !== d.sftpUsername.trim() ||
  (c.realtime_url ?? '') !== d.realtimeUrl.trim();

export const needsSecret = (c: ClearinghouseConnection | null, d: ConnectionDraft) =>
  !c?.secret_set || endpointChanged(c, d);

export const secretHint = (c: ClearinghouseConnection | null, d: ConnectionDraft) => {
  if (!c?.secret_set) return undefined;
  return endpointChanged(c, d)
    ? 'Enter the password again for the changed server or account.'
    : 'A password is set. Leave blank to keep it, or type a new one.';
};

export const NO_SECRET_STORE = 'This server cannot store clearinghouse passwords yet';

export const saveBlocked = (
  c: ClearinghouseConnection | null,
  d: ConnectionDraft,
  canStoreSecrets: boolean
) => !canStoreSecrets && (d.secret !== '' || needsSecret(c, d));

export const receiverHint = (vendor: ClearinghouseVendor) => {
  const receiverId = VENDOR_PRESETS[vendor].receiverId;
  return receiverId
    ? `Set the billing profile Receiver ID to ${receiverId}.`
    : 'Use the receiver ID your clearinghouse gives you in the billing profile.';
};

export const ConnectionForm = ({
  connection,
  canStoreSecrets,
  onSave,
  onRemove
}: {
  connection: ClearinghouseConnection | null;
  canStoreSecrets: boolean;
  onSave: (input: ConnectionInput) => Promise<string | null>;
  onRemove: () => Promise<string | null>;
}) => {
  const [draft, setDraft] = useState(() => toConnectionDraft(connection));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const failure = await onSave(fromConnectionDraft(draft));
    setError(failure ?? '');
    if (failure === null) setDraft((d) => ({ ...d, secret: '' }));
    setBusy(false);
  };
  const remove = async () => {
    setConfirming(false);
    setBusy(true);
    setError((await onRemove()) ?? '');
    setBusy(false);
  };
  const inputs = (fields: TextField[]) =>
    fields.map((f) => (
      <Input
        key={f.key}
        id={`connection-${f.key}`}
        label={f.label}
        hint={f.hint}
        span={f.span}
        type={f.type}
        required={f.required}
        value={draft[f.key]}
        onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
      />
    ));
  return (
    <form onSubmit={submit} aria-label="Clearinghouse connection">
      <SectionPanel
        title="Clearinghouse Connection"
        description="Where this agency sends claims, eligibility and claim status requests and picks up the answers. Without one, the server default is used."
      >
        <fieldset disabled={busy}>
          <FieldGroups>
            <FieldGroup title="Clearinghouse">
              <FieldGrid>
                <Select
                  id="connection-vendor"
                  label="Clearinghouse"
                  hint={receiverHint(draft.vendor)}
                  span={2}
                  options={VENDOR_OPTIONS}
                  value={draft.vendor}
                  onChange={(e) =>
                    isVendor(e.target.value) && setDraft(withVendor(draft, e.target.value))
                  }
                />
                <Select
                  id="connection-enabled"
                  label="Status"
                  hint="While paused, nothing is sent or picked up for this agency"
                  span={2}
                  options={ENABLED_OPTIONS}
                  value={draft.enabled}
                  onChange={(e) =>
                    setDraft({ ...draft, enabled: e.target.value === 'off' ? 'off' : 'on' })
                  }
                />
              </FieldGrid>
            </FieldGroup>
            <FieldGroup title="SFTP Account">
              <FieldGrid>
                {inputs(SFTP_FIELDS)}
                <Input
                  id="connection-secret"
                  label="Password"
                  type="password"
                  autoComplete="new-password"
                  hint={secretHint(connection, draft)}
                  required={needsSecret(connection, draft)}
                  value={draft.secret}
                  onChange={(e) => setDraft({ ...draft, secret: e.target.value })}
                />
              </FieldGrid>
            </FieldGroup>
            <FieldGroup title="Files">
              <FieldGrid>
                {inputs(FOLDER_FIELDS)}
                <Select
                  id="connection-afterDownload"
                  label="After Download"
                  options={AFTER_DOWNLOAD_OPTIONS}
                  value={draft.afterDownload}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      afterDownload: e.target.value === 'keep' ? 'keep' : 'delete'
                    })
                  }
                />
              </FieldGrid>
            </FieldGroup>
            <FieldGroup title="Real Time">
              <FieldGrid>
                <Input
                  id="connection-realtimeUrl"
                  label="CORE Real-Time URL"
                  hint="Eligibility and claim status answered at once; leave blank to send batch files only. Uses the SFTP username and password."
                  type="url"
                  span={4}
                  value={draft.realtimeUrl}
                  onChange={(e) => setDraft({ ...draft, realtimeUrl: e.target.value })}
                />
              </FieldGrid>
            </FieldGroup>
          </FieldGroups>
        </fieldset>
        {canStoreSecrets ? null : (
          <Alert intent="warning">
            {NO_SECRET_STORE}; ask your system administrator to set it up.
          </Alert>
        )}
        {error ? <Alert>{error}</Alert> : null}
        <FormActions>
          {connection ? (
            <Button
              type="button"
              variant="outline"
              intent="danger"
              disabledReason={busy ? 'Saving' : undefined}
              onClick={() => setConfirming(true)}
            >
              <Trash2Icon aria-hidden="true" className="size-4" />
              Remove Connection
            </Button>
          ) : null}
          <Button
            type="submit"
            isPending={busy}
            disabledReason={
              saveBlocked(connection, draft, canStoreSecrets) ? NO_SECRET_STORE : undefined
            }
          >
            <SaveIcon aria-hidden="true" className="size-4" />
            Save Connection
          </Button>
        </FormActions>
      </SectionPanel>
      {connection ? (
        <ConfirmDialog
          open={confirming}
          title="Remove Connection?"
          intent="danger"
          confirmLabel="Remove Connection"
          confirmIcon={Trash2Icon}
          dismissLabel="Keep Connection"
          onClose={() => setConfirming(false)}
          onConfirm={() => void remove()}
        >
          This agency stops using its own clearinghouse account and its stored password is deleted.
          The server default connection applies, if there is one.
        </ConfirmDialog>
      ) : null}
    </form>
  );
};
