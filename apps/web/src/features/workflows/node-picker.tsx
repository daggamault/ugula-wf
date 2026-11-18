import { useEffect, useId, useRef, useState } from 'react';
import { classNamesOf } from '../../shared/class-names.ts';
import type { PaletteEntry } from '../../shared/graph/catalog.ts';
import { Checkbox } from '../../shared/ui/checkbox.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { interactiveClasses } from '../../shared/ui/interactive.ts';

type Point = { x: number; y: number };

type NodePickerProps = {
  entries: readonly PaletteEntry[];
  at: Point;
  hint?: string | undefined;
  onAdd: (entry: PaletteEntry) => void;
  onClose: () => void;
};

const ADVANCED_KEY = 'workflows.picker.advanced';

const searchText = (e: PaletteEntry) =>
  `${e.title} ${e.description} ${e.category} ${e.keywords.join(' ')}`.toLowerCase();

export const groupPalette = (
  entries: readonly PaletteEntry[],
  query: string,
  showAdvanced = true
) => {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const groups = new Map<string, PaletteEntry[]>();
  for (const e of entries) {
    if (!showAdvanced && e.level === 'advanced') continue;
    const text = searchText(e);
    if (!words.every((w) => text.includes(w))) continue;
    const group = groups.get(e.category);
    if (group) group.push(e);
    else groups.set(e.category, [e]);
  }
  return [...groups];
};

export const nextActive = (count: number, active: number, key: string) => {
  if (!count) return 0;
  if (key === 'ArrowDown') return (active + 1) % count;
  if (key === 'ArrowUp') return (active - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return active;
};

const storedAdvanced = () => globalThis.localStorage?.getItem(ADVANCED_KEY) === 'shown';

export const NodePicker = ({ entries, at, hint, onAdd, onClose }: NodePickerProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const closer = useRef(onClose);
  closer.current = onClose;
  const [query, setQuery] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(storedAdvanced);
  const [active, setActive] = useState(0);
  const titleId = useId();
  const listId = useId();
  const advancedId = useId();
  const groups = groupPalette(entries, query, showAdvanced);
  const flat = groups.flatMap(([, items]) => items);
  const optionId = (i: number) => `${listId}-${i}`;
  const hiddenAdvanced =
    !showAdvanced && !flat.length && groupPalette(entries, query, true).length > 0;

  useEffect(() => {
    const el = ref.current;
    if (el && !el.matches(':popover-open')) el.showPopover();
    search.current?.focus();
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && !el?.contains(e.target)) closer.current();
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closer.current();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', onEscape);
      if (el?.matches(':popover-open')) el.hidePopover();
    };
  }, []);

  useEffect(() => {
    globalThis.document?.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
  });

  let index = 0;
  return (
    <div
      ref={ref}
      popover="manual"
      role="dialog"
      aria-labelledby={titleId}
      style={{
        left: `clamp(0.5rem, ${at.x}px, calc(100vw - min(24rem, 100vw - 1rem) - 0.5rem))`,
        top: `clamp(0.5rem, ${at.y}px, calc(100dvh - var(--spacing-overlay) - 0.5rem))`
      }}
      className="bg-surface text-surface-fg border-border max-h-overlay fixed m-0 flex w-[min(24rem,calc(100vw-1rem))] scale-95 flex-col gap-3 rounded-xl border p-3 opacity-0 shadow-lg transition-[opacity,scale,display,overlay] transition-discrete duration-200 ease-out open:scale-100 open:opacity-100 starting:open:scale-95 starting:open:opacity-0"
    >
      <header className="flex flex-col gap-0.5">
        <h2 id={titleId} className="text-base font-bold">
          Add Node
        </h2>
        {hint ? <p className="text-surface-fg-muted text-xs">{hint}</p> : null}
      </header>
      <input
        ref={search}
        type="search"
        role="combobox"
        aria-label="Search Nodes"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={flat.length ? optionId(active) : undefined}
        aria-autocomplete="list"
        placeholder="For Example: Round, Wait, Payer"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            setActive(nextActive(flat.length, active, e.key));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const entry = flat[active];
            if (entry) onAdd(entry);
          }
        }}
        className={classNamesOf(
          interactiveClasses,
          'bg-surface border-border hover:bg-surface-hover h-10 rounded-lg border px-3 text-sm pointer-coarse:h-11'
        )}
      />
      <label htmlFor={advancedId} className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox
          id={advancedId}
          checked={showAdvanced}
          onChange={(e) => {
            setShowAdvanced(e.target.checked);
            setActive(0);
            localStorage.setItem(ADVANCED_KEY, e.target.checked ? 'shown' : 'hidden');
          }}
        />
        Show Advanced
      </label>
      {flat.length ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Nodes"
          className="flex min-h-0 flex-col gap-3 overflow-y-auto"
        >
          {groups.map(([category, items]) => (
            <fieldset key={category} className="flex flex-col">
              <legend className="text-surface-fg-muted px-3 py-1 text-xs font-semibold tracking-wide uppercase">
                {category}
              </legend>
              {items.map((e) => {
                const i = index++;
                return (
                  <div
                    key={`${e.type}@${e.version}:${JSON.stringify(e.config ?? null)}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    tabIndex={-1}
                    onMouseMove={() => setActive(i)}
                    onClick={() => onAdd(e)}
                    onKeyDown={(k) => {
                      if (k.key === 'Enter') onAdd(e);
                    }}
                    className="aria-selected:bg-surface-fg/6 flex cursor-pointer flex-col gap-0.5 rounded-lg px-3 py-2"
                  >
                    <span className="text-sm font-semibold">{e.title}</span>
                    <span className="text-surface-fg-muted text-xs">{e.description}</span>
                  </div>
                );
              })}
            </fieldset>
          ))}
        </div>
      ) : (
        <EmptyText reason="noMatches">
          {hiddenAdvanced
            ? 'Only advanced nodes match. Turn on Show Advanced to see them.'
            : query
              ? `No node matches “${query}”.`
              : 'No node fits here.'}
        </EmptyText>
      )}
    </div>
  );
};
