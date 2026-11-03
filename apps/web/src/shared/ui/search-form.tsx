import { ChevronDownIcon, SearchIcon, XIcon } from 'lucide-react';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { classNamesOf } from '../class-names.ts';
import { navigate, useLocation } from '../router.tsx';
import { hrefWith } from '../url-state.ts';
import { Badge } from './badge.tsx';
import { Button } from './button.tsx';
import { Collapse } from './collapse.tsx';
import { FieldGrid, FormActions } from './field.tsx';
import { Input } from './input.tsx';
import { interactiveClasses } from './interactive.ts';
import { Select, type SelectOption } from './select.tsx';

export type SearchField = {
  name: string;
  label: string;
  type?: 'text' | 'date' | 'select';
  placeholder?: string;
  options?: readonly SelectOption[];
  defaultValue?: string;
};

const fieldValue = (f: SearchField, query: URLSearchParams) =>
  query.get(f.name) ?? f.defaultValue ?? '';

const isSet = (f: SearchField, value: string | undefined) =>
  Boolean(value?.trim()) && value?.trim() !== (f.defaultValue ?? '');

export const activeCount = (fields: readonly SearchField[], query: URLSearchParams) =>
  fields.filter((f) => isSet(f, query.get(f.name) ?? undefined)).length;

export const searchHref = (
  path: string,
  query: URLSearchParams,
  fields: readonly SearchField[],
  values: Readonly<Record<string, string>>
) =>
  hrefWith(path, query, {
    ...Object.fromEntries(
      fields.map((f) => [
        f.name,
        isSet(f, values[f.name]) ? (values[f.name]?.trim() ?? null) : null
      ])
    ),
    page: null
  });

const SearchFields = ({
  label,
  path,
  fields,
  query
}: {
  label: string;
  path: string;
  fields: readonly SearchField[];
  query: URLSearchParams;
}) => {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, fieldValue(f, query)]))
  );
  const active = activeCount(fields, query) > 0;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    navigate(searchHref(path, query, fields, values));
  };
  const set = (name: string, value: string) => setValues({ ...values, [name]: value });
  return (
    <search aria-label={label}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <FieldGrid>
          {fields.map((f) => (
            <div key={f.name} className="min-w-0">
              {f.type === 'select' ? (
                <Select
                  id={`search-${f.name}`}
                  label={f.label}
                  options={f.options ?? []}
                  value={values[f.name] ?? ''}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              ) : (
                <Input
                  id={`search-${f.name}`}
                  label={f.label}
                  type={f.type ?? 'search'}
                  placeholder={f.placeholder}
                  value={values[f.name] ?? ''}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              )}
            </div>
          ))}
        </FieldGrid>
        <FormActions>
          {active ? (
            <Button variant="outline" onClick={() => navigate(searchHref(path, query, fields, {}))}>
              <XIcon aria-hidden="true" className="size-4" />
              Clear
            </Button>
          ) : null}
          <Button type="submit">
            <SearchIcon aria-hidden="true" className="size-4" />
            Search
          </Button>
        </FormActions>
      </form>
    </search>
  );
};

const CollapsibleFilters = ({
  title,
  count,
  children
}: {
  title: string;
  count: number;
  children: ReactNode;
}) => {
  const id = useId();
  const [isOpen, setOpen] = useState(true);
  return (
    <div className="border-border bg-surface flex flex-col rounded-xl border">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={id}
        onClick={() => setOpen(!isOpen)}
        className={classNamesOf(
          interactiveClasses,
          'hover:bg-surface-hover flex h-12 items-center gap-2 rounded-xl px-4 text-left text-sm font-semibold'
        )}
      >
        <ChevronDownIcon
          aria-hidden="true"
          className={classNamesOf(
            'size-4 transition-transform duration-300 ease-out',
            isOpen ? '' : '-rotate-90'
          )}
        />
        {title}
        {count ? <Badge intent="info">{count} active</Badge> : null}
      </button>
      <Collapse id={id} isOpen={isOpen}>
        <div className="px-4 pb-4">{children}</div>
      </Collapse>
    </div>
  );
};

export const SearchForm = ({
  label,
  path,
  fields,
  collapsibleTitle
}: {
  label: string;
  path: string;
  fields: readonly SearchField[];
  collapsibleTitle?: string;
}) => {
  const { query } = useLocation();
  const key = fields.map((f) => query.get(f.name) ?? '').join('\u0000');
  const form = <SearchFields key={key} label={label} path={path} fields={fields} query={query} />;
  return collapsibleTitle ? (
    <CollapsibleFilters title={collapsibleTitle} count={activeCount(fields, query)}>
      {form}
    </CollapsibleFilters>
  ) : (
    form
  );
};
