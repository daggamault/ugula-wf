import {
  CopyPlusIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  GitCompareArrowsIcon,
  NetworkIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  SaveIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  UploadIcon
} from 'lucide-react';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { pendingActionMessage } from '../../shared/ui/disabled-reason.tsx';
import { NativeSelect } from '../../shared/ui/select.tsx';
import type { EditScope, GraphDetail } from './client.ts';
import { scopeLabel } from './scope-badges.tsx';
import { kindLabel } from './workflows-page.tsx';

export type Busy = 'save' | 'publish' | 'override' | 'remove' | 'rebase';

type EditorActionsProps = {
  detail: GraphDetail;
  version: number;
  editable: boolean;
  removable: boolean;
  dirty: boolean;
  busy: Busy | null;
  settingsHref: string;
  compareHref: string | null;
  removed: { href: string; shown: boolean } | null;
  onAdd: () => void;
  onArrange: () => void;
  onVersion: (version: number) => void;
  onOverride: (scope: EditScope) => void;
  onRemove: () => void;
  onSave: () => void;
  onPublish: () => void;
};

export const EditorActions = ({
  detail: { graph, versions },
  version,
  editable,
  removable,
  dirty,
  busy,
  settingsHref,
  compareHref,
  removed,
  onAdd,
  onArrange,
  onVersion,
  onOverride,
  onRemove,
  onSave,
  onPublish
}: EditorActionsProps) => {
  const label = kindLabel(graph.kind);
  const isDraft = versions.some((v) => v.version === version && !v.published_at);
  const hasDraft = versions.some((v) => !v.published_at);
  return (
    <>
      {editable ? (
        <Button onClick={onAdd}>
          <PlusIcon aria-hidden="true" className="size-4" />
          Add Node
        </Button>
      ) : null}
      {editable ? (
        <Button variant="outline" onClick={onArrange}>
          <NetworkIcon aria-hidden="true" className="size-4" />
          Arrange Nodes
        </Button>
      ) : null}
      <ButtonLink to={settingsHref} variant="outline">
        <SlidersHorizontalIcon aria-hidden="true" className="size-4" />
        {label} Settings
      </ButtonLink>
      <div className="w-36">
        <NativeSelect
          aria-label="Version"
          value={String(version)}
          options={versions.map((v) => ({
            value: String(v.version),
            label: `v${v.version}${v.published_at ? '' : ' (Draft)'}`
          }))}
          onChange={(e) => onVersion(Number(e.target.value))}
        />
      </div>
      {graph.effectiveId !== graph.id ? (
        <ButtonLink to={`/workflows/${graph.effectiveId}`} variant="outline">
          <ExternalLinkIcon aria-hidden="true" className="size-4" />
          Open {scopeLabel(graph.effectiveScope)} Copy
        </ButtonLink>
      ) : null}
      {graph.canOverride.organization && graph.effectiveScope === 'system' ? (
        <Button
          variant="outline"
          isPending={busy === 'override'}
          onClick={() => onOverride('organization')}
        >
          <CopyPlusIcon aria-hidden="true" className="size-4" />
          Override for Organization
        </Button>
      ) : null}
      {graph.canOverride.agency && graph.effectiveScope !== 'agency' ? (
        <Button
          variant="outline"
          isPending={busy === 'override'}
          onClick={() => onOverride('agency')}
        >
          <CopyPlusIcon aria-hidden="true" className="size-4" />
          Override for This Agency
        </Button>
      ) : null}
      {compareHref ? (
        <ButtonLink to={compareHref} variant="outline">
          <GitCompareArrowsIcon aria-hidden="true" className="size-4" />
          Compare
        </ButtonLink>
      ) : null}
      {removed ? (
        <ButtonLink to={removed.href} variant="outline">
          {removed.shown ? (
            <EyeOffIcon aria-hidden="true" className="size-4" />
          ) : (
            <EyeIcon aria-hidden="true" className="size-4" />
          )}
          {removed.shown ? 'Hide Removed' : 'Show Removed'}
        </ButtonLink>
      ) : null}
      {removable ? (
        <Button variant="outline" intent="danger" isPending={busy === 'remove'} onClick={onRemove}>
          <Trash2Icon aria-hidden="true" className="size-4" />
          {graph.overrides ? 'Remove Override' : `Delete ${label}`}
        </Button>
      ) : null}
      {graph.canEdit && !isDraft && !hasDraft ? (
        <Button variant="outline" isPending={busy === 'save'} onClick={onSave}>
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
              busy === 'publish' ? pendingActionMessage : dirty ? undefined : 'No changes to save.'
            }
            onClick={onSave}
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
            onClick={onPublish}
          >
            <UploadIcon aria-hidden="true" className="size-4" />
            Publish
          </Button>
        </>
      ) : null}
      {graph.kind === 'workflow' && versions.some((v) => v.published_at) ? (
        <ButtonLink to={`/runs/new?graph=${graph.id}`} variant="outline">
          <PlayIcon aria-hidden="true" className="size-4" />
          Run
        </ButtonLink>
      ) : null}
    </>
  );
};
