import { RotateCcwIcon, Trash2Icon } from 'lucide-react';
import { ConfirmDialog } from '../../shared/ui/dialog.tsx';
import type { GraphDetail } from './client.ts';
import { kindLabel } from './workflows-page.tsx';

export type EditorDialog = 'add' | 'remove' | 'reset';

type EditorDialogsProps = {
  graph: GraphDetail['graph'];
  dialog: EditorDialog | null;
  removable: boolean;
  leaving: string | null;
  onClose: () => void;
  onRemove: () => void;
  onReset: () => void;
  onStay: () => void;
  onLeave: (to: string) => void;
};

export const EditorDialogs = ({
  graph,
  dialog,
  removable,
  leaving,
  onClose,
  onRemove,
  onReset,
  onStay,
  onLeave
}: EditorDialogsProps) => {
  const label = kindLabel(graph.kind);
  return (
    <>
      {removable ? (
        <ConfirmDialog
          open={dialog === 'remove'}
          title={graph.overrides ? 'Remove Override?' : `Delete ${label}?`}
          intent="danger"
          confirmLabel={graph.overrides ? 'Remove Override' : `Delete ${label}`}
          confirmIcon={Trash2Icon}
          dismissLabel="Keep"
          onClose={onClose}
          onConfirm={() => {
            onClose();
            onRemove();
          }}
        >
          {graph.overrides
            ? `Are you sure? New runs go back to the ${graph.name} this copy overrides. Runs that already started keep using your copy. Override it again later to bring your copy back.`
            : `Are you sure? ${graph.name} and its versions are deleted. Runs that already started keep the version they use.`}
        </ConfirmDialog>
      ) : null}
      <ConfirmDialog
        open={dialog === 'reset'}
        title="Start From Base?"
        intent="danger"
        confirmLabel="Start From Base"
        confirmIcon={RotateCcwIcon}
        dismissLabel="Keep My Draft"
        onClose={onClose}
        onConfirm={() => {
          onClose();
          onReset();
        }}
      >
        Are you sure? Your draft of {graph.name} is replaced with the newest base and your changes
        in it are lost. Published versions of your copy stay as they are until you publish again.
      </ConfirmDialog>
      <ConfirmDialog
        open={leaving !== null}
        title="Discard Unsaved Changes?"
        intent="danger"
        confirmLabel="Discard Changes"
        confirmIcon={Trash2Icon}
        dismissLabel="Keep Editing"
        onClose={onStay}
        onConfirm={() => {
          onStay();
          if (leaving) onLeave(leaving);
        }}
      >
        Your changes to {graph.name} have not been saved. Leave anyway and lose them?
      </ConfirmDialog>
    </>
  );
};
