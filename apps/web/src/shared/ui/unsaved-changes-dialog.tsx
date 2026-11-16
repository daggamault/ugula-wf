import { Trash2Icon } from 'lucide-react';
import { discard, stay, usePendingLeave } from '../router.tsx';
import { ConfirmDialog } from './dialog.tsx';

export const UnsavedChangesDialog = () => (
  <ConfirmDialog
    open={usePendingLeave() !== null}
    title="Discard Unsaved Changes?"
    intent="danger"
    confirmLabel="Discard Changes"
    confirmIcon={Trash2Icon}
    dismissLabel="Keep Editing"
    onClose={stay}
    onConfirm={discard}
  >
    Your changes have not been saved. Leave anyway and lose them?
  </ConfirmDialog>
);
