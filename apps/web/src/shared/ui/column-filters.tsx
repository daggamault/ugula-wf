import { ChevronDownIcon, XIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { classNamesOf } from '../class-names.ts';
import { navigate } from '../router.tsx';
import type { FacetOption, Facets, SearchView } from '../url-state.ts';
import { Button, buttonClasses } from './button.tsx';
import { Checkbox } from './checkbox.tsx';
import { Input } from './input.tsx';

export type ColumnFilter = {
  key: string;
  label: string;
  labelOf?: (option: FacetOption) => string;
};

type Choice = { value: string; label: string; count: number };

const FIND_FROM = 9;

const defaultLabel = (o: FacetOption) => o.label ?? o.value;

export const choicesOf = (
  filter: ColumnFilter,
  options: readonly FacetOption[],
  selected: readonly string[]
): Choice[] => {
  const labelOf = filter.labelOf ?? defaultLabel;
  const missing = selected
    .filter((value) => !options.some((o) => o.value === value))
    .map((value) => ({ value, count: 0 }));
  return [...options, ...missing]
    .map((o) => ({ value: o.value, label: labelOf(o), count: o.count }))
    .sort((a, b) => a.label.localeCompare(b.label));
};

export const toggled = (selected: readonly string[], value: string) =>
  selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];

const FilterPanel = ({
  filter,
  choices,
  selected,
  search
}: {
  filter: ColumnFilter;
  choices: readonly Choice[];
  selected: readonly string[];
  search: SearchView;
}) => {
  const [find, setFind] = useState('');
  const baseId = useId();
  const findId = `${baseId}-find`;
  const needle = find.trim().toLowerCase();
  const shown = needle ? choices.filter((c) => c.label.toLowerCase().includes(needle)) : choices;
  return (
    <>
      {choices.length >= FIND_FROM ? (
        <div className="px-1 pb-2">
          <Input
            id={findId}
            label={`Find ${filter.label}`}
            isLabelHidden
            type="search"
            placeholder={`Find ${filter.label.toLowerCase()}`}
            value={find}
            onChange={(e) => setFind(e.target.value)}
          />
        </div>
      ) : null}
      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">{filter.label}</legend>
        {shown.map((c) => (
          <label
            key={c.value}
            htmlFor={`${baseId}-${c.value}`}
            className="hover:bg-surface-fg/6 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition duration-150 ease-out pointer-coarse:py-3"
          >
            <Checkbox
              id={`${baseId}-${c.value}`}
              checked={selected.includes(c.value)}
              onChange={() => navigate(search.filterHref(filter.key, toggled(selected, c.value)))}
            />
            <span className="min-w-0 flex-1 truncate text-sm">{c.label}</span>
            <span className="text-surface-fg-muted text-xs tabular-nums">{c.count}</span>
          </label>
        ))}
        {shown.length ? null : (
          <p className="text-surface-fg-muted px-3 py-2 text-sm">
            {choices.length
              ? `No ${filter.label.toLowerCase()} matches.`
              : 'Nothing to filter yet.'}
          </p>
        )}
      </fieldset>
      {selected.length ? (
        <div className="border-border mt-2 border-t px-1 pt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(search.filterHref(filter.key, []))}
          >
            <XIcon aria-hidden="true" className="size-4" />
            Clear {filter.label}
          </Button>
        </div>
      ) : null}
    </>
  );
};

const ColumnFilterButton = ({
  filter,
  options,
  search
}: {
  filter: ColumnFilter;
  options: readonly FacetOption[];
  search: SearchView;
}) => {
  const panelId = `filter-${useId().replace(/[^\w-]/g, '')}`;
  const anchorName = `--${panelId}`;
  const selected = search.filters[filter.key] ?? [];
  const isActive = selected.length > 0;
  return (
    <div className="flex" style={{ anchorName }}>
      <button
        type="button"
        popoverTarget={panelId}
        aria-haspopup="dialog"
        className={classNamesOf(
          buttonClasses({ variant: 'outline' }),
          'cursor-pointer',
          isActive && 'border-primary/30 bg-primary/10 text-primary'
        )}
      >
        {filter.label}
        {isActive ? (
          <span className="bg-primary text-primary-fg rounded-full px-1.5 text-xs/5 tabular-nums">
            {selected.length}
            <span className="sr-only"> selected</span>
          </span>
        ) : null}
        <ChevronDownIcon aria-hidden="true" className="size-4" />
      </button>
      <div
        id={panelId}
        popover="auto"
        role="dialog"
        aria-label={`Filter by ${filter.label}`}
        style={{ positionAnchor: anchorName }}
        className="bg-surface text-surface-fg border-border max-h-overlay inset-auto m-2 w-72 max-w-[calc(100vw-1rem)] scale-95 overflow-y-auto rounded-xl border p-2 opacity-0 shadow-lg transition-[opacity,scale,display,overlay] transition-discrete duration-200 ease-out [position-area:bottom_span-right] [position-try-fallbacks:flip-inline] open:scale-100 open:opacity-100 starting:open:scale-95 starting:open:opacity-0"
      >
        <FilterPanel
          filter={filter}
          choices={choicesOf(filter, options, selected)}
          selected={selected}
          search={search}
        />
      </div>
    </div>
  );
};

export const ColumnFilters = ({
  filters,
  facets,
  search
}: {
  filters: readonly ColumnFilter[];
  facets: Facets | undefined;
  search: SearchView;
}) => (
  <div className="flex flex-wrap items-center gap-2">
    {filters.map((f) => (
      <ColumnFilterButton key={f.key} filter={f} options={facets?.[f.key] ?? []} search={search} />
    ))}
  </div>
);
