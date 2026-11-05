import { type FieldSpec, isRecord, type Json } from '@ugula/graph';
import { ArrowRightIcon, UndoIcon } from 'lucide-react';
import { classNamesOf } from '../../shared/class-names.ts';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import { interactiveClasses } from '../../shared/ui/interactive.ts';
import { fieldLabel } from './outcomes.ts';

export type FieldChange = { field: FieldSpec; was: Json; now: Json };

const isBlank = (value: Json | undefined) =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && !value.trim()) ||
  (Array.isArray(value) && !value.length);

const sameValue = (a: Json | undefined, b: Json | undefined) =>
  (isBlank(a) && isBlank(b)) || JSON.stringify(a) === JSON.stringify(b);

export const changesOf = (
  fields: readonly FieldSpec[],
  defaults: Readonly<Record<string, Json>> | null,
  values: Readonly<Record<string, Json>>
): FieldChange[] =>
  fields.flatMap((field) => {
    const was = defaults?.[field.name] ?? null;
    const now = values[field.name] ?? null;
    return sameValue(was, now) ? [] : [{ field, was, now }];
  });

export const changeValueText = (field: FieldSpec, value: Json): string => {
  if (isBlank(value)) return emptyValue;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') {
    return field.options?.find((o) => o.value === value)?.label ?? value;
  }
  if (typeof value === 'number') return value.toLocaleString();
  if (Array.isArray(value)) return value.map((v) => changeValueText(field, v)).join(', ');
  if (isRecord(value) && typeof value.name === 'string') return value.name;
  return JSON.stringify(value);
};

export const ChangeList = ({ changes }: { changes: readonly FieldChange[] }) => (
  <section aria-label="Your changes" className="flex flex-col gap-2">
    <h3 className="text-sm font-medium">
      {changes.length ? (
        <>
          Your Changes <span className="text-surface-fg-muted font-normal">({changes.length})</span>
        </>
      ) : (
        'No Changes Yet'
      )}
    </h3>
    {changes.length ? (
      <ul className="border-border divide-border flex flex-col divide-y rounded-xl border text-sm">
        {changes.map(({ field, was, now }) => (
          <li key={field.name} className="flex flex-col gap-1 px-3 py-2">
            <span className="text-surface-fg-muted text-xs font-medium">{fieldLabel(field)}</span>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 break-words">
              <span
                className={
                  isBlank(was) ? 'text-surface-fg-muted' : 'text-surface-fg-muted line-through'
                }
              >
                <span className="sr-only">Current: </span>
                {changeValueText(field, was)}
              </span>
              <ArrowRightIcon aria-hidden="true" className="text-surface-fg-muted size-3.5" />
              <span className="font-medium">
                <span className="sr-only">New: </span>
                {changeValueText(field, now)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-surface-fg-muted text-sm">
        Fields show the current values. Anything you change is listed here as current → new.
      </p>
    )}
  </section>
);

export const FieldWas = ({
  field,
  was,
  onReset
}: {
  field: FieldSpec;
  was: Json;
  onReset: () => void;
}) => (
  <p className="text-warning-fg flex flex-wrap items-center gap-x-2 text-xs">
    <span>
      Changed from <span className="font-medium">{changeValueText(field, was)}</span>
    </span>
    <button
      type="button"
      onClick={onReset}
      className={classNamesOf(
        interactiveClasses,
        'text-surface-fg-muted hover:text-surface-fg inline-flex items-center gap-1 rounded underline-offset-2 hover:underline'
      )}
    >
      <UndoIcon aria-hidden="true" className="size-3" />
      Undo<span className="sr-only"> change to {fieldLabel(field)}</span>
    </button>
  </p>
);
