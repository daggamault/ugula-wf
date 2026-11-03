import { type ReactNode, useId } from 'react';
import { classNamesOf } from '../class-names.ts';

export const fieldControlClasses =
  'border-border bg-surface placeholder:text-surface-fg-muted/70 focus-visible:outline-primary aria-invalid:border-danger aria-invalid:focus-visible:outline-danger [&:enabled:not([readonly])]:hover:border-surface-fg/25 [&:enabled:not([readonly])]:hover:bg-surface-hover w-full rounded-lg border px-3 outline-2 outline-offset-0 outline-transparent transition duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50';

export const fieldTextClasses = 'text-base sm:text-sm';

export type FieldSpan = 1 | 2 | 4;

const fieldSpanClasses: Readonly<Record<FieldSpan, string>> = {
  1: '',
  2: '@lg:col-span-2',
  4: '@lg:col-span-2 @3xl:col-span-4'
};

export type FieldProps = {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  isRequired?: boolean | undefined;
  span?: FieldSpan | undefined;
  children: ReactNode;
};

export const errorIdOf = (id: string) => `${id}-error`;

export const hintIdOf = (id: string) => `${id}-hint`;

export const describedByOf = (id: string, error?: string, hint?: string) =>
  error ? errorIdOf(id) : hint ? hintIdOf(id) : undefined;

export const Field = ({ id, label, error, hint, isRequired, span = 1, children }: FieldProps) => (
  <div className={classNamesOf('flex min-w-0 flex-col gap-1.5', fieldSpanClasses[span])}>
    <label htmlFor={id} className="text-sm font-medium">
      {label}
      {isRequired && (
        <span aria-hidden="true" className="text-danger ml-0.5">
          *
        </span>
      )}
    </label>
    {children}
    {error ? (
      <p id={errorIdOf(id)} role="alert" className="text-danger text-sm">
        {error}
      </p>
    ) : hint ? (
      <p id={hintIdOf(id)} className="text-surface-fg-muted text-xs">
        {hint}
      </p>
    ) : null}
  </div>
);

export const FieldGrid = ({ children }: { children: ReactNode }) => (
  <div className="@container">
    <div className="grid grid-cols-1 gap-x-4 gap-y-5 @lg:grid-cols-2 @3xl:grid-cols-4">
      {children}
    </div>
  </div>
);

export const FieldGroup = ({ title, children }: { title: string; children: ReactNode }) => {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-4">
      <h3 id={headingId} className="text-base font-bold">
        {title}
      </h3>
      {children}
    </section>
  );
};

export const FieldGroups = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-col gap-8">{children}</div>
);

export const FormActions = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
    {children}
  </div>
);
