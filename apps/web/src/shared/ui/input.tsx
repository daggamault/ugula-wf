import type { InputHTMLAttributes } from 'react';
import { classNamesOf } from '../class-names.ts';
import { describedByOf, Field, type FieldSpan, fieldControlClasses } from './field.tsx';

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  span?: FieldSpan | undefined;
  isMonospace?: boolean;
};

export const inputClasses = classNamesOf(
  'min-h-10 read-only:bg-canvas read-only:text-surface-fg-muted [&::-webkit-calendar-picker-indicator]:cursor-pointer',
  fieldControlClasses
);

export const Input = ({
  id,
  label,
  error,
  hint,
  span,
  isMonospace = false,
  ...rest
}: InputProps) => (
  <Field id={id} label={label} error={error} hint={hint} isRequired={rest.required} span={span}>
    <input
      id={id}
      aria-invalid={Boolean(error) || undefined}
      aria-describedby={describedByOf(id, error, hint)}
      className={classNamesOf(inputClasses, isMonospace && 'font-mono')}
      {...rest}
    />
  </Field>
);
