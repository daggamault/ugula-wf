import { CheckIcon, ChevronDownIcon, SearchIcon } from 'lucide-react';
import {
  type FocusEvent,
  type KeyboardEvent,
  type ToggleEvent,
  useEffect,
  useId,
  useRef,
  useState
} from 'react';
import { classNamesOf } from '../class-names.ts';
import {
  describedByOf,
  Field,
  type FieldSpan,
  fieldControlClasses,
  fieldTextClasses
} from './field.tsx';
import { hidePopover, showPopover } from './popover.ts';

export type SelectOption = {
  value: string;
  label: string;
};

const SEARCH_THRESHOLD = 7;

type ControlProps = {
  id?: string | undefined;
  label?: string | undefined;
  options: readonly SelectOption[];
  name?: string | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  required?: boolean | undefined;
  isSearchable?: boolean | undefined;
  title?: string | undefined;
  'aria-label'?: string | undefined;
  'aria-invalid'?: boolean | undefined;
  'aria-describedby'?: string | undefined;
};

type SingleProps = ControlProps & {
  isMultiple?: false;
  value: string;
  onChange: (value: string) => void;
};

type MultipleProps = ControlProps & {
  isMultiple: true;
  value: readonly string[];
  onChange: (value: string[]) => void;
};

export type SelectControlProps = SingleProps | MultipleProps;

const triggerClasses = classNamesOf(
  fieldControlClasses,
  fieldTextClasses,
  'flex h-10 cursor-pointer items-center pr-9 text-left pointer-coarse:h-11'
);

const panelClasses =
  'bg-surface text-surface-fg border-border inset-auto my-1 max-h-[min(20rem,60vh)] min-w-[anchor-size(width)] scale-95 flex-col overflow-hidden rounded-xl border p-1 opacity-0 shadow-lg transition-[opacity,scale,display,overlay] transition-discrete duration-200 ease-out [position-area:bottom_span-right] [position-try-fallbacks:flip-block] open:flex open:scale-100 open:opacity-100 motion-reduce:transition-none starting:open:scale-95 starting:open:opacity-0';

const optionClasses =
  'data-[active=true]:bg-surface-fg/6 aria-selected:bg-primary/10 aria-selected:text-primary flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm';

const TYPEAHEAD_MS = 600;

const valuesOf = (props: SelectControlProps): readonly string[] =>
  props.isMultiple ? props.value : [props.value];

export const summaryOf = (options: readonly SelectOption[], values: readonly string[]) => {
  const labels = values.flatMap((v) => options.find((o) => o.value === v)?.label ?? []);
  const [first] = labels;
  return first === undefined ? null : labels.length > 1 ? `${first} +${labels.length - 1}` : first;
};

export const matchesOf = (options: readonly SelectOption[], query: string) => {
  const q = query.trim().toLowerCase();
  return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
};

export const typeaheadIndex = (options: readonly SelectOption[], typed: string, active: number) => {
  const isRepeat = [...typed].every((c) => c === typed[0]);
  const text = isRepeat ? typed.charAt(0) : typed;
  const from = isRepeat ? active + 1 : active;
  const order = [...options.keys()].map((i) => (from + i) % options.length);
  return order.find((i) => options[i]?.label.toLowerCase().startsWith(text)) ?? -1;
};

const nextActive = (key: string, active: number, count: number) =>
  key === 'ArrowDown'
    ? Math.min(active + 1, count - 1)
    : key === 'ArrowUp'
      ? Math.max(active - 1, 0)
      : key === 'Home'
        ? 0
        : key === 'End'
          ? count - 1
          : null;

export const SelectControl = (props: SelectControlProps) => {
  const {
    options,
    name,
    placeholder,
    disabled,
    title,
    isMultiple = false,
    isSearchable = options.length > SEARCH_THRESHOLD
  } = props;
  const ownId = useId().replace(/[^\w-]/g, '');
  const id = props.id ?? `select-${ownId}`;
  const panelId = `${id}-panel`;
  const listId = `${id}-list`;
  const anchorName = `--${id}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [isOpen, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const typed = useRef({ text: '', at: 0 });
  const values = valuesOf(props);
  const shown = matchesOf(options, query);
  const optionId = (i: number) => `${listId}-${i}`;
  const activeOption = shown[active];
  const summary = summaryOf(options, values);
  const listName = props.label ?? props['aria-label'];

  useEffect(() => {
    if (isOpen)
      document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, active, listId]);

  const onToggle = (e: ToggleEvent<HTMLDivElement>) => {
    const opened = e.newState === 'open';
    setOpen(opened);
    if (!opened) return;
    setQuery('');
    setActive(
      Math.max(
        0,
        options.findIndex((o) => values.includes(o.value))
      )
    );
    (isSearchable ? searchRef.current : listRef.current)?.focus();
  };

  const close = () => {
    hidePopover(panelRef.current);
    triggerRef.current?.focus();
  };

  const choose = (option: SelectOption) => {
    if (props.isMultiple) {
      props.onChange(
        values.includes(option.value)
          ? values.filter((v) => v !== option.value)
          : [...values, option.value]
      );
      return;
    }
    if (option.value !== props.value) props.onChange(option.value);
    close();
  };

  const onLeave = (e: FocusEvent) => {
    const to = e.relatedTarget;
    if (to instanceof Node && !panelRef.current?.contains(to) && to !== triggerRef.current) {
      hidePopover(panelRef.current);
    }
  };

  const onListKey = (e: KeyboardEvent) => {
    const next = nextActive(e.key, active, shown.length);
    if (next !== null) {
      e.preventDefault();
      setActive(next);
    } else if (e.key === 'Enter' || (e.key === ' ' && !isSearchable)) {
      e.preventDefault();
      if (activeOption) choose(activeOption);
    } else if (e.key === 'Tab') {
      hidePopover(panelRef.current);
    } else if (!isSearchable && e.key.length === 1) {
      const recent = e.timeStamp - typed.current.at < TYPEAHEAD_MS ? typed.current.text : '';
      typed.current = { text: recent + e.key.toLowerCase(), at: e.timeStamp };
      const at = typeaheadIndex(shown, typed.current.text, active);
      if (at !== -1) setActive(at);
    }
  };

  return (
    <div className="relative flex min-w-0" style={{ anchorName }}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        popoverTarget={panelId}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-label={props['aria-label']}
        aria-invalid={props['aria-invalid']}
        aria-describedby={props['aria-describedby']}
        className={triggerClasses}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            showPopover(panelRef.current);
          }
        }}
      >
        <span className={classNamesOf('truncate', !summary && 'text-surface-fg-muted')}>
          {summary || placeholder || ''}
        </span>
      </button>
      <ChevronDownIcon
        aria-hidden="true"
        className="text-surface-fg-muted pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
      />
      {name ? values.map((v) => <input key={v} type="hidden" name={name} value={v} />) : null}
      <div
        ref={panelRef}
        id={panelId}
        popover="auto"
        style={{ positionAnchor: anchorName }}
        className={panelClasses}
        onToggle={onToggle}
      >
        {isSearchable ? (
          <div className="relative mb-1 flex shrink-0">
            <SearchIcon
              aria-hidden="true"
              className="text-surface-fg-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            />
            <input
              ref={searchRef}
              type="search"
              role="combobox"
              aria-label={`Search ${listName ?? 'options'}`}
              aria-expanded={isOpen}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeOption ? optionId(active) : undefined}
              autoComplete="off"
              placeholder="Search"
              value={query}
              className={classNamesOf(fieldControlClasses, fieldTextClasses, 'h-9 pl-9')}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onListKey}
              onBlur={onLeave}
            />
          </div>
        ) : null}
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={listName}
          aria-multiselectable={isMultiple || undefined}
          aria-activedescendant={!isSearchable && activeOption ? optionId(active) : undefined}
          className="flex min-h-0 flex-col gap-0.5 overflow-y-auto outline-none"
          onKeyDown={isSearchable ? undefined : onListKey}
          onBlur={onLeave}
        >
          {shown.map((o, i) => {
            const isChosen = values.includes(o.value);
            return (
              <button
                key={o.value}
                id={optionId(i)}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={isChosen}
                data-value={o.value}
                data-active={i === active}
                className={optionClasses}
                onPointerMove={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
              >
                <span className="min-w-0 flex-1 truncate">{o.label || ' '}</span>
                {isChosen ? <CheckIcon aria-hidden="true" className="size-4 shrink-0" /> : null}
              </button>
            );
          })}
        </div>
        {shown.length ? null : (
          <p className="text-surface-fg-muted px-3 py-2 text-sm">No matches</p>
        )}
      </div>
    </div>
  );
};

type SelectProps = SelectControlProps & {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  span?: FieldSpan | undefined;
  isLabelHidden?: boolean | undefined;
};

export const Select = ({ label, error, hint, span, isLabelHidden, ...rest }: SelectProps) => (
  <Field
    id={rest.id}
    label={label}
    error={error}
    hint={hint}
    isRequired={rest.required}
    isLabelHidden={isLabelHidden}
    span={span}
  >
    <SelectControl
      {...rest}
      label={label}
      aria-invalid={Boolean(error) || undefined}
      aria-describedby={describedByOf(rest.id, error, hint)}
    />
  </Field>
);
