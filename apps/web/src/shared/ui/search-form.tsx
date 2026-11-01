import { SearchIcon, XIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { navigate, useLocation } from '../router.tsx';
import { hrefWith } from '../url-state.ts';
import { Button } from './button.tsx';
import { Input } from './input.tsx';

export type SearchField = {
  name: string;
  label: string;
  type?: 'text' | 'date';
  placeholder?: string;
};

export const searchHref = (
  path: string,
  query: URLSearchParams,
  fields: readonly SearchField[],
  values: Readonly<Record<string, string>>
) =>
  hrefWith(path, query, {
    ...Object.fromEntries(fields.map((f) => [f.name, values[f.name]?.trim() || null])),
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
    Object.fromEntries(fields.map((f) => [f.name, query.get(f.name) ?? '']))
  );
  const active = fields.some((f) => query.get(f.name));
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    navigate(searchHref(path, query, fields, values));
  };
  return (
    <search aria-label={label}>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        {fields.map((f) => (
          <div key={f.name} className={f.type === 'date' ? 'w-44' : 'min-w-48 flex-1 sm:max-w-xs'}>
            <Input
              id={`search-${f.name}`}
              label={f.label}
              type={f.type ?? 'search'}
              placeholder={f.placeholder}
              value={values[f.name] ?? ''}
              onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
            />
          </div>
        ))}
        <Button type="submit" variant="outline">
          <SearchIcon aria-hidden="true" className="size-4" />
          Search
        </Button>
        {active ? (
          <Button variant="outline" onClick={() => navigate(searchHref(path, query, fields, {}))}>
            <XIcon aria-hidden="true" className="size-4" />
            Clear
          </Button>
        ) : null}
      </form>
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
