import { ChevronDownIcon } from 'lucide-react';
import type { SelectHTMLAttributes } from 'react';
import { classNamesOf } from '../class-names.ts';
import { describedByOf, Field, type FieldSpan, fieldControlClasses } from './field.tsx';

export type SelectOption = {
  value: string;
  label: string;
};

export const selectClasses = classNamesOf(
  'min-h-10 appearance-none truncate pr-9',
  fieldControlClasses
);

export const SelectChevron = () => (
  <ChevronDownIcon
    aria-hidden="true"
    className="text-surface-fg-muted pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
  />
);

export type NativeSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> & {
  options: readonly SelectOption[];
};

export const NativeSelect = ({ options, ...rest }: NativeSelectProps) => (
  <span className="relative flex">
    <select className={selectClasses} {...rest}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
    <SelectChevron />
  </span>
);

export type SelectProps = NativeSelectProps & {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  span?: FieldSpan | undefined;
};

export const Select = ({ id, label, error, hint, span, ...rest }: SelectProps) => (
  <Field id={id} label={label} error={error} hint={hint} isRequired={rest.required} span={span}>
    <NativeSelect
      id={id}
      aria-invalid={Boolean(error) || undefined}
      aria-describedby={describedByOf(id, error, hint)}
      {...rest}
    />
  </Field>
);
