import { useState } from 'react';
import type { PaletteEntry } from '../../shared/graph/catalog.ts';
import { Input } from '../../shared/ui/input.tsx';

export type PaletteProps = {
  entries: readonly PaletteEntry[];
  disabled: boolean;
  onAdd: (entry: PaletteEntry) => void;
};

export const groupPalette = (entries: readonly PaletteEntry[], query: string) => {
  const q = query.trim().toLowerCase();
  const groups = new Map<string, PaletteEntry[]>();
  for (const e of entries) {
    if (q && !`${e.title} ${e.type} ${e.category}`.toLowerCase().includes(q)) continue;
    const group = groups.get(e.category);
    if (group) group.push(e);
    else groups.set(e.category, [e]);
  }
  return [...groups];
};

export const Palette = ({ entries, disabled, onAdd }: PaletteProps) => {
  const [query, setQuery] = useState('');
  return (
    <nav aria-label="Node palette" className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
      <Input
        id="palette-search"
        label="Add node"
        type="search"
        placeholder="Search nodes"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {groupPalette(entries, query).map(([category, items]) => (
        <details key={category} open={query ? true : undefined} className="group">
          <summary className="text-surface-fg-muted hover:bg-surface-fg/6 hover:text-surface-fg flex items-center justify-between rounded-md px-2 py-1.5 text-xs font-semibold tracking-wide uppercase">
            {category}
            <span className="bg-surface-fg/6 rounded-full px-1.5 font-normal tabular-nums">
              {items.length}
            </span>
          </summary>
          <ul className="mt-1 flex flex-col">
            {items.map((e) => (
              <li key={`${e.type}@${e.version}`}>
                <button
                  type="button"
                  disabled={disabled}
                  title={e.description}
                  onClick={() => onAdd(e)}
                  className="not-disabled:hover:bg-primary/10 not-disabled:hover:text-primary w-full rounded-md px-2 py-1 text-left text-sm disabled:opacity-50"
                >
                  {e.title}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </nav>
  );
};
