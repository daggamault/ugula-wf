import { PencilIcon, PlusIcon, SaveIcon, Trash2Icon, XIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { classNamesOf } from '../../shared/class-names.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { ConfirmDialog, Dialog, DialogActions } from '../../shared/ui/dialog.tsx';
import { EmptyState } from '../../shared/ui/empty-state.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { interactiveClasses } from '../../shared/ui/interactive.ts';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { pageOf, useTableState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { Payer, PayerAlias, SettingsClient } from './client.ts';
import { FILING_OPTIONS } from './settings-page.tsx';

const PayerNames = ({
  payer,
  onForget
}: {
  payer: Payer;
  onForget: (payer: Payer, alias: PayerAlias) => void;
}) =>
  payer.aliases.length ? (
    <ul aria-label={`Report names for ${payer.name}`} className="flex flex-wrap gap-1">
      {payer.aliases.map((a) => (
        <li key={a.id}>
          <button
            type="button"
            aria-label={`Forget ${a.alias} for ${payer.name}`}
            onClick={() => onForget(payer, a)}
            className={classNamesOf(
              interactiveClasses,
              'border-border text-surface-fg-muted hover:border-danger/40 hover:bg-danger/10 hover:text-danger inline-flex items-center gap-1 rounded-full border py-0.5 pr-1.5 pl-2 text-xs'
            )}
          >
            {a.alias}
            <XIcon aria-hidden="true" className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  ) : null;

export const PAYER_TABLE = {
  sorts: { name: 'asc', payerId: 'asc', filing: 'asc' },
  sort: 'name'
} as const;

const PAYER_VALUES = {
  name: (p: Payer) => p.name,
  payerId: (p: Payer) => p.payer_id,
  filing: (p: Payer) => p.claim_filing
};

export const PayerDirectory = ({
  payers,
  onSave,
  onDelete,
  onForget,
  open,
  onOpen,
  onClose
}: {
  payers: readonly Payer[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSave: (payer: { name: string; payerId: string; claimFiling: string }) => Promise<boolean>;
  onDelete: (payer: Payer) => void;
  onForget: (payer: Payer, alias: PayerAlias) => void;
}) => {
  const empty = { name: '', payerId: '', claimFiling: 'CI' };
  const [draft, setDraft] = useState(empty);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState<Payer | null>(null);
  const table = useTableState('/payers', PAYER_TABLE);
  const reset = () => {
    setDraft(empty);
    setEditing(false);
    onClose();
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (await onSave(draft)) reset();
  };
  return (
    <>
      <Dialog
        open={open}
        onClose={reset}
        title={editing ? 'Edit Payer' : 'Add a Payer'}
        description="The payer ID and claim filing code come from your clearinghouse's payer list."
      >
        <form
          onSubmit={submit}
          className={`flex flex-col gap-4 rounded-lg border p-4 ${editing ? 'border-primary/40 bg-primary/5' : 'border-border bg-canvas'}`}
          aria-label="Save payer"
        >
          <div className="grid gap-x-4 gap-y-5">
            <Input
              id="payer-name"
              label="Payer name"
              required
              readOnly={editing}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <Input
              id="payer-id"
              label="Payer ID"
              required
              isMonospace
              value={draft.payerId}
              onChange={(e) => setDraft({ ...draft, payerId: e.target.value })}
            />
            <Select
              id="payer-filing"
              label="Claim filing"
              options={FILING_OPTIONS}
              value={draft.claimFiling}
              onChange={(e) => setDraft({ ...draft, claimFiling: e.target.value })}
            />
          </div>
          <DialogActions>
            <Button variant="outline" onClick={reset}>
              <XIcon aria-hidden="true" className="size-4" />
              Cancel
            </Button>
            <Button type="submit">
              <SaveIcon aria-hidden="true" className="size-4" />
              Save payer
            </Button>
          </DialogActions>
        </form>
      </Dialog>
      {payers.length ? (
        <Table
          label="Payer directory"
          sorting={table}
          head={[
            { label: 'Payer', sort: 'name' },
            { label: 'Payer ID', sort: 'payerId' },
            { label: 'Claim Filing', isSecondary: true, sort: 'filing' },
            { label: 'Actions', isLabelHidden: true, isCompact: true }
          ]}
        >
          {pageOf(payers, table, PAYER_VALUES).items.map((p) => (
            <TableRow key={p.id}>
              <TableCell>
                <span className="flex flex-col gap-1.5">
                  <span className="font-medium">{p.name}</span>
                  <PayerNames payer={p} onForget={onForget} />
                </span>
              </TableCell>
              <TableCell>
                <span className="font-mono">{p.payer_id}</span>
              </TableCell>
              <TableCell isMuted isSecondary>
                {FILING_OPTIONS.find((o) => o.value === p.claim_filing)?.label ?? p.claim_filing}
              </TableCell>
              <TableCell kind="actions">
                <span className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Edit ${p.name}`}
                    onClick={() => {
                      setEditing(true);
                      setDraft({ name: p.name, payerId: p.payer_id, claimFiling: p.claim_filing });
                      onOpen();
                    }}
                  >
                    <PencilIcon aria-hidden="true" className="size-4" />
                    Edit
                  </Button>
                  <Button
                    intent="danger"
                    variant="outline"
                    size="sm"
                    aria-label={`Delete ${p.name}`}
                    onClick={() => setDeleting(p)}
                  >
                    <Trash2Icon aria-hidden="true" className="size-4" />
                    Delete
                  </Button>
                </span>
              </TableCell>
            </TableRow>
          ))}
        </Table>
      ) : null}
      {payers.length ? (
        <Pagination label="Payers" total={payers.length} state={table} />
      ) : (
        <EmptyState title="No Payers Yet">
          Claims cannot go in an 837P file until their payers are listed here. Use Add payer to add
          one.
        </EmptyState>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete Payer?"
        intent="danger"
        confirmLabel="Delete"
        confirmIcon={Trash2Icon}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) onDelete(deleting);
          setDeleting(null);
        }}
      >
        {deleting
          ? `Its prices are removed, and claims billed to ${deleting.name} cannot go in an 837P file until it is added again.`
          : null}
      </ConfirmDialog>
    </>
  );
};

export const payerSavedNotice = (name: string, linkedClaims: number) =>
  linkedClaims
    ? `${name} saved and linked to ${linkedClaims} ${linkedClaims === 1 ? 'claim' : 'claims'}.`
    : `${name} saved.`;

export const PayersPage = ({ client }: { client: SettingsClient }) => {
  const payers = useResource('payers', client.payers);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const notify = useToast();
  const act = async <T,>(action: () => Promise<T>, done: (result: T) => string) => {
    setError('');
    try {
      notify({ title: done(await action()) });
      payers.reload();
      return true;
    } catch (err) {
      setError(messageOf(err));
      return false;
    }
  };
  return (
    <Page
      title="Payers"
      description="Payer IDs and filing codes for 837P claims. Report payer names match here automatically, or through a Payer matching task."
      actions={
        <Button onClick={() => setOpen(true)}>
          <PlusIcon aria-hidden="true" className="size-4" />
          Add payer
        </Button>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      {payers.error ? <Alert>{payers.error.message}</Alert> : null}
      {payers.data ? (
        <PayerDirectory
          payers={payers.data}
          open={open}
          onOpen={() => setOpen(true)}
          onClose={() => setOpen(false)}
          onSave={(p) =>
            act(
              () => client.savePayer(p),
              (saved) => payerSavedNotice(saved.payer.name, saved.linkedClaims)
            )
          }
          onDelete={(p) =>
            void act(
              () => client.removePayer(p.id),
              () => `${p.name} deleted.`
            )
          }
          onForget={(p, a) =>
            void act(
              () => client.forgetAlias(p.id, a.id),
              () => `Reports naming ${a.alias} no longer link to ${p.name}.`
            )
          }
        />
      ) : (
        <PageLoading />
      )}
    </Page>
  );
};
