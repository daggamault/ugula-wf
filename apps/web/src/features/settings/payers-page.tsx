import { PencilIcon, PlusIcon, SaveIcon, Trash2Icon, XIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { classNamesOf } from '../../shared/class-names.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { ConfirmDialog, Dialog, DialogActions } from '../../shared/ui/dialog.tsx';
import { EmptyState } from '../../shared/ui/empty-state.tsx';
import { IconButton } from '../../shared/ui/icon-button.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { interactiveClasses } from '../../shared/ui/interactive.ts';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { type SearchField, SearchForm } from '../../shared/ui/search-form.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { pageOf, useTableState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { Payer, PayerAlias, SettingsClient } from './client.ts';
import { FILING_OPTIONS } from './settings-page.tsx';

const PATH = '/payers';

const SEARCH_FIELDS: readonly SearchField[] = [
  { name: 'q', label: 'Payer', placeholder: 'Name or payer ID' }
];

export const matchesPayer = (p: Payer, search: string) => {
  const needle = search.trim().toLowerCase();
  return (
    !needle || p.name.toLowerCase().includes(needle) || p.payer_id.toLowerCase().includes(needle)
  );
};

type Forgetting = { payer: Payer; alias: PayerAlias };

const PayerNames = ({
  payer,
  onForget
}: {
  payer: Payer;
  onForget: (payer: Payer, alias: PayerAlias) => void;
}) =>
  payer.aliases.length ? (
    <ul aria-label={`Learned names for ${payer.name}`} className="flex flex-wrap gap-1">
      {payer.aliases.map((a) => (
        <li key={a.id}>
          <button
            type="button"
            aria-label={`Forget ${a.alias} for ${payer.name}`}
            onClick={() => onForget(payer, a)}
            className={classNamesOf(
              interactiveClasses,
              'border-border text-surface-fg-muted hover:border-danger/40 hover:bg-danger/10 hover:text-danger inline-flex items-center gap-1 rounded-full border pr-1.5 pl-2 text-xs/5'
            )}
          >
            {a.alias}
            <XIcon aria-hidden="true" className="size-3.5" />
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
  isSearching,
  onSave,
  onDelete,
  onForget,
  open,
  onOpen,
  onClose
}: {
  payers: readonly Payer[];
  isSearching: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSave: (payer: { name: string; payerId: string; claimFiling: string }) => Promise<string | null>;
  onDelete: (payer: Payer) => void;
  onForget: (payer: Payer, alias: PayerAlias) => void;
}) => {
  const empty = { name: '', payerId: '', claimFiling: 'CI' };
  const [draft, setDraft] = useState(empty);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<Payer | null>(null);
  const [forgetting, setForgetting] = useState<Forgetting | null>(null);
  const table = useTableState(PATH, PAYER_TABLE);
  const reset = () => {
    setDraft(empty);
    setEditing(false);
    setError('');
    onClose();
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const failure = await onSave(draft);
    setBusy(false);
    if (failure) setError(failure);
    else reset();
  };
  return (
    <>
      <Dialog
        open={open}
        onClose={reset}
        title={editing ? 'Edit Payer' : 'Add Payer'}
        description="The payer ID and claim filing code come from your clearinghouse's payer list."
      >
        <form onSubmit={submit} className="flex flex-col gap-5" aria-label="Save payer">
          <fieldset disabled={busy} className="grid gap-x-4 gap-y-5">
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
          </fieldset>
          {error ? <Alert>{error}</Alert> : null}
          <DialogActions>
            <Button variant="outline" onClick={reset}>
              <XIcon aria-hidden="true" className="size-4" />
              Cancel
            </Button>
            <Button type="submit" isPending={busy}>
              <SaveIcon aria-hidden="true" className="size-4" />
              Save payer
            </Button>
          </DialogActions>
        </form>
      </Dialog>
      {payers.length ? (
        <>
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
                  <span className="flex flex-col gap-1">
                    <span className="font-medium">{p.name}</span>
                    <PayerNames
                      payer={p}
                      onForget={(payer, alias) => setForgetting({ payer, alias })}
                    />
                  </span>
                </TableCell>
                <TableCell>
                  <span className="font-mono">{p.payer_id}</span>
                </TableCell>
                <TableCell isMuted isSecondary>
                  {FILING_OPTIONS.find((o) => o.value === p.claim_filing)?.label ?? p.claim_filing}
                </TableCell>
                <TableCell kind="actions">
                  <span className="flex items-center justify-end gap-2">
                    <IconButton
                      label={`Edit ${p.name}`}
                      icon={PencilIcon}
                      onClick={() => {
                        setEditing(true);
                        setError('');
                        setDraft({
                          name: p.name,
                          payerId: p.payer_id,
                          claimFiling: p.claim_filing
                        });
                        onOpen();
                      }}
                    />
                    <IconButton
                      label={`Delete ${p.name}`}
                      icon={Trash2Icon}
                      intent="danger"
                      onClick={() => setDeleting(p)}
                    />
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </Table>
          <Pagination label="Payers" total={payers.length} state={table} />
        </>
      ) : isSearching ? (
        <EmptyState reason="noMatches" title="No Matching Payers">
          Nothing matches this search.
        </EmptyState>
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
      <ConfirmDialog
        open={forgetting !== null}
        title="Forget Name?"
        intent="danger"
        confirmLabel="Forget"
        confirmIcon={XIcon}
        onClose={() => setForgetting(null)}
        onConfirm={() => {
          if (forgetting) onForget(forgetting.payer, forgetting.alias);
          setForgetting(null);
        }}
      >
        {forgetting
          ? `PCRs naming ${forgetting.alias.alias} stop linking to ${forgetting.payer.name}; the next one goes to a Payer matching task.`
          : null}
      </ConfirmDialog>
    </>
  );
};

export const payerSavedNotice = (name: string, linkedClaims: number) =>
  linkedClaims
    ? `${name} saved and linked to ${linkedClaims} ${linkedClaims === 1 ? 'claim' : 'claims'}`
    : `${name} saved`;

export const PayersPage = ({ client, search }: { client: SettingsClient; search: string }) => {
  const payers = useResource('payers', client.payers);
  const [open, setOpen] = useState(false);
  const notify = useToast();
  const act = async (action: () => Promise<unknown>, done: string, failed: string) => {
    try {
      await action();
      notify({ title: done });
      payers.reload();
    } catch (err) {
      notify({ intent: 'danger', title: failed, description: messageOf(err) });
    }
  };
  return (
    <Page
      title="Payers"
      description="Payer IDs and filing codes for 837P claims. Payer names on PCRs match here automatically, or through a Payer matching task."
      actions={
        <Button onClick={() => setOpen(true)}>
          <PlusIcon aria-hidden="true" className="size-4" />
          Add payer
        </Button>
      }
    >
      <SearchForm label="Search payers" path={PATH} fields={SEARCH_FIELDS} />
      {payers.error ? (
        <Alert>{payers.error.message}</Alert>
      ) : payers.data ? (
        <PayerDirectory
          payers={payers.data.filter((p) => matchesPayer(p, search))}
          isSearching={Boolean(search.trim())}
          open={open}
          onOpen={() => setOpen(true)}
          onClose={() => setOpen(false)}
          onSave={async (p) => {
            try {
              const saved = await client.savePayer(p);
              notify({ title: payerSavedNotice(saved.payer.name, saved.linkedClaims) });
              payers.reload();
              return null;
            } catch (err) {
              return messageOf(err);
            }
          }}
          onDelete={(p) =>
            void act(() => client.removePayer(p.id), `${p.name} deleted`, 'Could not delete payer')
          }
          onForget={(p, a) =>
            void act(
              () => client.forgetAlias(p.id, a.id),
              `${a.alias} no longer links to ${p.name}`,
              'Could not forget name'
            )
          }
        />
      ) : (
        <PageLoading />
      )}
    </Page>
  );
};
