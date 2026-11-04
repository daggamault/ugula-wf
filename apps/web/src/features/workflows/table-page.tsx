import { deepEqual, type Json } from '@ugula/graph';
import {
  CopyPlusIcon,
  ExternalLinkIcon,
  PencilIcon,
  RotateCcwIcon,
  SaveIcon,
  Trash2Icon,
  UploadIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { type Live, useReconnect } from '../../shared/live.ts';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { ConfirmDialog } from '../../shared/ui/dialog.tsx';
import { pendingActionMessage } from '../../shared/ui/disabled-reason.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { NativeSelect } from '../../shared/ui/select.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { EditScope, TableComparison, TableDetail, WorkflowsClient } from './client.ts';
import { CopyBadge, ScopeBadge, StaleBadge, scopeLabel } from './scope-badges.tsx';
import { DecisionTableEditor, LookupTableEditor } from './table-editors.tsx';
import { TABLES_PATH, tableKindLabel } from './tables-page.tsx';

type TableViewProps = {
  detail: TableDetail;
  version: number;
  source: Json;
  comparison: TableComparison | null;
  client: WorkflowsClient;
  onSaved: () => void;
};

export const tablePath = (id: string, version?: number) =>
  `${TABLES_PATH}/${id}${version ? `?version=${version}` : ''}`;

type Busy = 'save' | 'publish' | 'override' | 'remove';

export const TableView = ({
  detail,
  version,
  source,
  comparison,
  client,
  onSaved
}: TableViewProps) => {
  const { table, versions } = detail;
  const current = versions.find((v) => v.version === version);
  const draft = versions.find((v) => !v.published_at);
  const isDraft = current !== undefined && !current.published_at;
  const editable = table.canEdit && isDraft;
  const [def, setDef] = useState<Json>(source);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const notify = useToast();
  const base = table.scope === 'system' ? undefined : comparison?.copiedFrom?.definition;
  const changed = base !== undefined && !deepEqual(base, def);
  const baseUpdated = table.scope !== 'system' && (table.is_stale || !!comparison?.baseChanged);
  const Editor = table.kind === 'decide' ? DecisionTableEditor : LookupTableEditor;

  const run = async (kind: Busy, action: () => Promise<void>) => {
    setBusy(kind);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(null);
    }
  };
  const save = () =>
    run('save', async () => {
      const saved = await client.tables.saveDraft(table.id, def);
      setDirty(false);
      notify({ title: `Draft v${saved.version} saved` });
      if (saved.version !== version) navigate(tablePath(table.id, saved.version));
      onSaved();
    });
  const publish = () =>
    run('publish', async () => {
      await client.tables.publish(table.id);
      notify({
        title: `${table.name} v${version} published`,
        description: 'New runs use this table from now on.'
      });
      onSaved();
    });
  const override = (scope: EditScope) =>
    run('override', async () => {
      const { id } = await client.tables.override(table.id, scope);
      notify({
        title: `${table.name} copied for ${scope === 'agency' ? 'this agency' : 'your organization'}`,
        description: 'Change and publish the copy; new runs then use it in every workflow.'
      });
      navigate(tablePath(id));
    });
  const remove = () =>
    run('remove', async () => {
      await client.tables.remove(table.id);
      notify({
        title: 'Override removed',
        description: `New runs use the ${table.name} below this copy again.`
      });
      navigate(table.overrides ? tablePath(table.overrides) : TABLES_PATH);
    });

  return (
    <Page
      title={table.name}
      backTo={TABLES_PATH}
      backLabel="Back to Tables"
      description={
        <span className="flex flex-wrap items-center gap-2">
          <code className="font-mono">{table.key}</code>
          <Badge intent={isDraft ? 'warning' : 'success'}>
            {isDraft ? `Draft v${version}` : `Published v${version}`}
          </Badge>
          <Badge>{tableKindLabel(table.kind)}</Badge>
          <ScopeBadge scope={table.scope} />
          <CopyBadge scope={table.scope} effective={table.effectiveScope} />
          <StaleBadge stale={baseUpdated} />
          {changed ? <Badge intent="custom">Changed From Base</Badge> : null}
          {dirty ? <Badge intent="danger">Unsaved</Badge> : null}
        </span>
      }
      actions={
        <>
          <div className="w-36">
            <NativeSelect
              aria-label="Version"
              value={String(version)}
              options={versions.map((v) => ({
                value: String(v.version),
                label: `v${v.version}${v.published_at ? '' : ' (Draft)'}`
              }))}
              onChange={(e) => navigate(tablePath(table.id, Number(e.target.value)))}
            />
          </div>
          {table.effectiveId !== table.id ? (
            <ButtonLink to={tablePath(table.effectiveId)} variant="outline">
              <ExternalLinkIcon aria-hidden="true" className="size-4" />
              Open {scopeLabel(table.effectiveScope)} Copy
            </ButtonLink>
          ) : null}
          {table.canOverride.organization && table.effectiveScope === 'system' ? (
            <Button
              variant="outline"
              isPending={busy === 'override'}
              onClick={() => override('organization')}
            >
              <CopyPlusIcon aria-hidden="true" className="size-4" />
              Override for Organization
            </Button>
          ) : null}
          {table.canOverride.agency && table.effectiveScope !== 'agency' ? (
            <Button
              variant="outline"
              isPending={busy === 'override'}
              onClick={() => override('agency')}
            >
              <CopyPlusIcon aria-hidden="true" className="size-4" />
              Override for This Agency
            </Button>
          ) : null}
          {table.overrides && table.canEdit ? (
            <Button
              variant="outline"
              intent="danger"
              isPending={busy === 'remove'}
              onClick={() => setConfirm(true)}
            >
              <Trash2Icon aria-hidden="true" className="size-4" />
              Remove Override
            </Button>
          ) : null}
          {table.canEdit && !isDraft && !draft ? (
            <Button variant="outline" isPending={busy === 'save'} onClick={save}>
              <PencilIcon aria-hidden="true" className="size-4" />
              Edit as New Draft
            </Button>
          ) : null}
          {editable ? (
            <>
              <Button
                variant="outline"
                isPending={busy === 'save'}
                disabledReason={
                  busy === 'publish'
                    ? pendingActionMessage
                    : dirty
                      ? undefined
                      : 'No changes to save.'
                }
                onClick={save}
              >
                <SaveIcon aria-hidden="true" className="size-4" />
                Save
              </Button>
              <Button
                isPending={busy === 'publish'}
                disabledReason={
                  busy === 'save'
                    ? pendingActionMessage
                    : dirty
                      ? 'Save your changes first.'
                      : undefined
                }
                onClick={publish}
              >
                <UploadIcon aria-hidden="true" className="size-4" />
                Publish
              </Button>
            </>
          ) : null}
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      {baseUpdated ? (
        <Alert intent="warning">
          <strong className="font-semibold">Base Updated.</strong>{' '}
          {table.is_stale
            ? 'The base changed its inputs or outputs, so runs use the base until this copy keeps the same fields.'
            : 'The base table has a newer version than the one this copy started from.'}
        </Alert>
      ) : null}
      {editable && base !== undefined && changed ? (
        <Alert
          intent="info"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDef(base);
                setDirty(true);
              }}
            >
              <RotateCcwIcon aria-hidden="true" className="size-4" />
              Reset to Base
            </Button>
          }
        >
          This copy changes the rows of the table it was copied from.
        </Alert>
      ) : null}
      <SectionPanel
        title={tableKindLabel(table.kind)}
        description={
          editable
            ? 'Change rows freely; keep the inputs and outputs so every workflow that uses this table still fits.'
            : table.scope === 'system'
              ? 'Built-in tables are read-only. Override this one to change its rows for your organization or agency.'
              : draft
                ? `Published versions are read-only. Open draft v${draft.version} to make changes.`
                : 'Published versions are read-only. Edit as a new draft to make changes.'
        }
        {...(changed ? { accent: 'custom' as const } : {})}
      >
        <Editor
          nodeId={table.id}
          config={def}
          editable={editable}
          onConfig={(config) => {
            setDef(config);
            setDirty(true);
          }}
        />
      </SectionPanel>
      <ConfirmDialog
        open={confirm}
        title="Remove Override?"
        intent="danger"
        confirmLabel="Remove Override"
        confirmIcon={Trash2Icon}
        dismissLabel="Keep"
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          void remove();
        }}
      >
        Are you sure? New runs go back to the {table.name} below this copy. Runs that already
        started keep using your copy.
      </ConfirmDialog>
    </Page>
  );
};

export const TablePage = ({
  client,
  live,
  tableId,
  version
}: {
  client: WorkflowsClient;
  live: Live;
  tableId: string;
  version: number | null;
}) => {
  const detail = useResource(`table:${tableId}`, (signal) => client.tables.find(tableId, signal));
  const comparison = useResource(`table:${tableId}:compare`, (signal) =>
    client.tables.compare(tableId, signal)
  );
  useReconnect(live, () => {
    detail.reload();
    comparison.reload();
  });
  const versions = detail.data?.versions ?? [];
  const chosen =
    version ?? versions.find((v) => !v.published_at)?.version ?? versions[0]?.version ?? null;
  const source = useResource(`table:${tableId}:v${chosen}`, () =>
    chosen === null ? Promise.resolve(null) : client.tables.version(tableId, chosen)
  );
  useEffect(() => {
    if (version === null && chosen !== null)
      navigate(tablePath(tableId, chosen), { replace: true });
  }, [tableId, version, chosen]);
  const failure = detail.error ?? source.error;
  if (failure) return <PageFailure message={failure.message} />;
  if (!detail.data || !source.data || chosen === null || source.data.version !== chosen) {
    return <PageLoading />;
  }
  return (
    <TableView
      key={`${tableId}:${chosen}`}
      detail={detail.data}
      version={chosen}
      source={source.data.definition}
      comparison={comparison.data ?? null}
      client={client}
      onSaved={() => {
        detail.reload();
        comparison.reload();
      }}
    />
  );
};
