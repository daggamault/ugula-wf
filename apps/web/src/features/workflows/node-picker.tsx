import { useId, useState } from 'react';
import { classNamesOf } from '../../shared/class-names.ts';
import type { PaletteEntry } from '../../shared/graph/catalog.ts';
import { Dialog } from '../../shared/ui/dialog.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { interactiveClasses } from '../../shared/ui/interactive.ts';

type NodePickerProps = {
  open: boolean;
  entries: readonly PaletteEntry[];
  onAdd: (entry: PaletteEntry) => void;
  onClose: () => void;
};

export const groupPalette = (entries: readonly PaletteEntry[], query: string) => {
  const q = query.trim().toLowerCase();
  const groups = new Map<string, PaletteEntry[]>();
  for (const e of entries) {
    if (q && !`${e.title} ${e.description} ${e.category}`.toLowerCase().includes(q)) continue;
    const group = groups.get(e.category);
    if (group) group.push(e);
    else groups.set(e.category, [e]);
  }
  return [...groups];
};

export const NodeList = ({
  entries,
  query,
  onAdd
}: {
  entries: readonly PaletteEntry[];
  query: string;
  onAdd: (entry: PaletteEntry) => void;
}) => {
  const groups = groupPalette(entries, query);
  return groups.length ? (
    <div className="flex max-h-[60dvh] flex-col gap-5 overflow-y-auto pr-1">
      {groups.map(([category, items]) => (
        <section key={category} className="flex flex-col gap-1">
          <h3 className="text-surface-fg-muted text-xs font-semibold tracking-wide uppercase">
            {category}
          </h3>
          <ul className="flex flex-col">
            {items.map((e) => (
              <li key={`${e.type}@${e.version}`}>
                <button
                  type="button"
                  onClick={() => onAdd(e)}
                  className={classNamesOf(
                    interactiveClasses,
                    'hover:bg-surface-fg/6 flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left'
                  )}
                >
                  <span className="text-sm font-semibold">{e.title}</span>
                  <span className="text-surface-fg-muted text-xs">{e.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  ) : (
    <EmptyText reason="noMatches">No node matches “{query}”.</EmptyText>
  );
};

export const NodePicker = ({ open, entries, onAdd, onClose }: NodePickerProps) => {
  const [query, setQuery] = useState('');
  const searchId = useId();
  return (
    <Dialog open={open} isWide title="Add Node" onClose={onClose}>
      <Input
        id={searchId}
        label="Search"
        type="search"
        placeholder="For example: round, wait, payer"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <NodeList
        entries={entries}
        query={query}
        onAdd={(entry) => {
          onAdd(entry);
          setQuery('');
        }}
      />
    </Dialog>
  );
};
