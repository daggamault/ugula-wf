import type { InputHTMLAttributes } from 'react';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  error?: string;
};

export const Input = ({ id, label, error, ...rest }: InputProps) => {
  const errorId = `${id}-error`;

  return (
    <label
      htmlFor={id}
      className="flex flex-col gap-1.5 text-sm font-medium text-neutral-900 dark:text-neutral-100"
    >
      <span>{label}</span>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={`min-h-10 w-full rounded-lg border bg-white px-3 py-2 text-sm text-neutral-950 transition-colors duration-150 placeholder:text-neutral-400 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-950 dark:text-neutral-50 dark:placeholder:text-neutral-500 ${
          error
            ? 'border-danger-500 focus-visible:ring-danger-500'
            : 'focus-visible:border-primary-900 focus-visible:ring-primary-900/20 dark:focus-visible:border-primary-100 dark:focus-visible:ring-primary-100/20 border-neutral-300 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-700'
        }`}
        {...rest}
      />
      {error ? (
        <span id={errorId} className="text-danger-600 dark:text-danger-400 text-xs">
          {error}
        </span>
      ) : null}
    </label>
  );
};
