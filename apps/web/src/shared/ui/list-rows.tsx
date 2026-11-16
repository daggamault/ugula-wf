import { PlusIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './button.tsx';
import { MoveButtons, RemoveButton } from './icon-button.tsx';

type ListRowsProps<T> = {
  id: string;
  noun: string;
  items: readonly T[];
  editable: boolean;
  blank: () => T;
  nameOf?: ((item: T, index: number) => string) | undefined;
  onChange: (items: T[]) => void;
  children: (item: T, index: number, set: (next: T) => void) => ReactNode;
};

export const moved = <T,>(items: readonly T[], index: number, by: -1 | 1): T[] => {
  const to = index + by;
  const item = items[index];
  if (item === undefined || to < 0 || to >= items.length) return [...items];
  const rest = items.filter((_, i) => i !== index);
  return [...rest.slice(0, to), item, ...rest.slice(to)];
};

export const ListRows = <T,>({
  id,
  noun,
  items,
  editable,
  blank,
  nameOf = (_, i) => `${noun} ${i + 1}`,
  onChange,
  children
}: ListRowsProps<T>) => (
  <div className="flex flex-col gap-3">
    {items.length ? (
      <ol className="flex flex-col gap-3">
        {items.map((item, i) => (
          <li key={`${id}-${i.toString()}`} className="flex items-end gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {children(item, i, (next) => onChange(items.map((x, j) => (j === i ? next : x))))}
            </div>
            {editable ? (
              <div className="flex items-center gap-1">
                <MoveButtons
                  name={nameOf(item, i)}
                  index={i}
                  count={items.length}
                  onMove={(by) => onChange(moved(items, i, by))}
                />
                <RemoveButton
                  label={`Remove ${nameOf(item, i)}`}
                  onClick={() => onChange(items.filter((_, j) => j !== i))}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    ) : null}
    {editable ? (
      <div>
        <Button variant="outline" size="sm" onClick={() => onChange([...items, blank()])}>
          <PlusIcon aria-hidden="true" className="size-4" />
          Add {noun}
        </Button>
      </div>
    ) : null}
  </div>
);
