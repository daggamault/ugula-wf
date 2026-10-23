import type { ComponentProps, ReactNode } from 'react';
import { classNamesOf } from '../class-names.ts';

export type TableColumn =
  | string
  | {
      label: string;
      isNumeric?: boolean;
      isCompact?: boolean;
      isSecondary?: boolean;
      isLabelHidden?: boolean;
    };

export type TableProps = {
  label: string;
  head: readonly TableColumn[];
  children: ReactNode;
};

const columnOf = (column: TableColumn) => (typeof column === 'string' ? { label: column } : column);

export const Table = ({ label, head, children }: TableProps) => (
  <div className="border-border bg-surface overflow-x-auto rounded-xl border">
    <table aria-label={label} className="w-full text-left text-sm">
      <thead>
        <tr>
          {head.map(columnOf).map((c) => (
            <th
              key={c.label}
              scope="col"
              className={classNamesOf(
                'border-border text-surface-fg-muted border-b px-4 py-3 text-xs font-semibold tracking-wide whitespace-nowrap uppercase',
                c.isNumeric && 'text-right',
                c.isCompact && 'w-px',
                c.isSecondary && 'hidden md:table-cell'
              )}
            >
              <span className={c.isLabelHidden ? 'sr-only' : undefined}>{c.label}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);

export const TableRow = ({ children }: { children: ReactNode }) => (
  <tr className="border-border hover:bg-surface-fg/3 border-b transition-colors duration-150 last:border-b-0">
    {children}
  </tr>
);

type TableCellKind = 'text' | 'numeric' | 'date' | 'actions';

const cellKindClasses: Readonly<Record<TableCellKind, string>> = {
  text: 'whitespace-nowrap',
  numeric: 'text-right whitespace-nowrap tabular-nums',
  date: 'whitespace-nowrap tabular-nums',
  actions: 'w-px whitespace-nowrap'
};

type TableCellProps = Omit<ComponentProps<'td'>, 'className'> & {
  isMuted?: boolean;
  isSecondary?: boolean;
  kind?: TableCellKind;
};

export const TableCell = ({
  isMuted = false,
  isSecondary = false,
  kind = 'text',
  ...props
}: TableCellProps) => (
  <td
    className={classNamesOf(
      'px-4 py-3 align-middle',
      isMuted && 'text-surface-fg-muted',
      isSecondary && 'hidden md:table-cell',
      cellKindClasses[kind]
    )}
    {...props}
  />
);

export const TableTotalRow = ({ children }: { children: ReactNode }) => (
  <tr className="bg-surface-fg/3 border-border border-t font-semibold">{children}</tr>
);
