import { SearchIcon, XIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { classNamesOf } from '../class-names.ts';
import { navigate, useLocation } from '../router.tsx';
import { hrefWith } from '../url-state.ts';
import { Button } from './button.tsx';
import { FieldGrid, FormActions } from './field.tsx';
import { Input } from './input.tsx';
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
  const isInline = fields.length === 1;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    navigate(searchHref(path, query, fields, values));
  };
  const set = (name: string, value: string) => setValues({ ...values, [name]: value });
  const controls = fields.map((f) => (
    <div key={f.name} className={classNamesOf('min-w-0', isInline && 'sm:w-80')}>
      {f.type === 'select' ? (
        <Select
          id={`search-${f.name}`}
          label={f.label}
          isLabelHidden={isInline}
          options={f.options ?? []}
          value={values[f.name] ?? ''}
          onChange={(e) => set(f.name, e.target.value)}
        />
      ) : (
        <Input
          id={`search-${f.name}`}
          label={f.label}
          isLabelHidden={isInline}
          type={f.type ?? 'search'}
          placeholder={f.placeholder}
          value={values[f.name] ?? ''}
          onChange={(e) => set(f.name, e.target.value)}
        />
      )}
    </div>
  ));
  const actions = (
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
  );
  return (
    <search
      aria-label={label}
      className={isInline ? undefined : 'border-border bg-surface rounded-xl border p-5'}
    >
      {isInline ? (
        <form onSubmit={submit} className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-2">
          {controls}
          {actions}
        </form>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FieldGrid>{controls}</FieldGrid>
          {actions}
        </form>
      )}
    </search>
  );
};

export const SearchForm = ({
  label,
  path,
  fields
}: {
  label: string;
  path: string;
  fields: readonly SearchField[];
}) => {
  const { query } = useLocation();
  const key = fields.map((f) => query.get(f.name) ?? '').join('\u0000');
  return <SearchFields key={key} label={label} path={path} fields={fields} query={query} />;
};
