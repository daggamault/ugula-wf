import type { TextareaHTMLAttributes } from 'react';
import { classNamesOf } from '../class-names.ts';
import {
  describedByOf,
  Field,
  type FieldSpan,
  fieldControlClasses,
  fieldTextClasses
} from './field.tsx';

type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> & {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  span?: FieldSpan | undefined;
  isMonospace?: boolean;
};

export const Textarea = ({
  id,
  label,
  error,
  hint,
  span,
  isMonospace = false,
  ...rest
}: TextareaProps) => (
  <Field id={id} label={label} error={error} hint={hint} isRequired={rest.required} span={span}>
    <textarea
      id={id}
      aria-invalid={Boolean(error) || undefined}
      aria-describedby={describedByOf(id, error, hint)}
      className={classNamesOf(
        'min-h-24 resize-y py-2',
        fieldControlClasses,
        isMonospace ? 'font-mono text-xs' : fieldTextClasses
      )}
      spellCheck={!isMonospace}
      {...rest}
    />
  </Field>
);
