import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react';
import {
  Children,
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
  useId
} from 'react';
import { classNamesOf } from '../class-names.ts';
import { Link, navigate } from '../router.tsx';
import type { SortDir } from '../url-state.ts';
import { interactiveClasses } from './interactive.ts';
import { NativeSelect } from './select.tsx';

type TableColumn =
  | string
  | {
      label: string;
      sort?: string;
      isCompact?: boolean;
      isSecondary?: boolean;
      isLabelHidden?: boolean;
    };

type Column = Exclude<TableColumn, string>;

export type TableSorting = {
  sort: string;
  dir: SortDir;
  sortHref(key: string): string;
  sortTo(key: string, dir: SortDir): string;
};

type TableProps = {
  label: string;
  head: readonly TableColumn[];
  sorting?: TableSorting;
  children: ReactNode;
};

const columnOf = (column: TableColumn): Column =>
  typeof column === 'string' ? { label: column } : column;

const Columns = createContext<readonly Column[]>([]);

const Position = createContext(0);

const secondaryClasses = 'md:hidden lg:table-cell';

const DIRECTION_LABELS: Readonly<Record<SortDir, string>> = {
  asc: 'Ascending',
  desc: 'Descending'
};

const SortIcon = ({ active, dir }: { active: boolean; dir: SortDir }) => {
  const Icon = !active ? ArrowUpDownIcon : dir === 'asc' ? ArrowUpIcon : ArrowDownIcon;
  return (
    <Icon
      aria-hidden="true"
      className={classNamesOf('size-3.5 shrink-0', active ? 'text-primary' : 'opacity-40')}
    />
  );
};

const HeaderCell = ({
  column,
  sorting
}: {
  column: Column;
  sorting?: TableSorting | undefined;
}) => {
  const active = column.sort !== undefined && sorting?.sort === column.sort;
  const content = (
    <span className={column.isLabelHidden ? 'sr-only' : undefined}>{column.label}</span>
  );
  return (
    <th
      scope="col"
      aria-sort={
        active && sorting ? (sorting.dir === 'asc' ? 'ascending' : 'descending') : undefined
      }
      className={classNamesOf(
        'border-border text-surface-fg-muted border-b px-4 py-3 text-xs font-semibold tracking-wide whitespace-nowrap uppercase',
        column.isCompact && 'w-px',
        column.isSecondary && secondaryClasses
      )}
    >
      {column.sort && sorting ? (
        <Link
          to={sorting.sortHref(column.sort)}
          className={classNamesOf(
            interactiveClasses,
            'hover:text-surface-fg inline-flex items-center gap-2 rounded-lg',
            active && 'text-surface-fg'
          )}
        >
          {content}
          <SortIcon active={active} dir={sorting.dir} />
        </Link>
      ) : (
        content
      )}
    </th>
  );
};

const MobileSort = ({
  columns,
  sorting
}: {
  columns: readonly Column[];
  sorting: TableSorting;
}) => {
  const id = useId();
  const current = `${sorting.sort}:${sorting.dir}`;
  const byColumn = columns.flatMap((c) =>
    c.sort
      ? (['asc', 'desc'] as const).map((dir) => ({
          value: `${c.sort}:${dir}`,
          label: `${c.label}, ${DIRECTION_LABELS[dir]}`
        }))
      : []
  );
  const options = byColumn.some((o) => o.value === current)
    ? byColumn
    : [{ value: current, label: 'Default Order' }, ...byColumn];
  return byColumn.length ? (
    <div className="flex items-center gap-2 md:hidden">
      <label htmlFor={id} className="text-surface-fg-muted shrink-0 text-sm font-medium">
        Sort By
      </label>
      <NativeSelect
        id={id}
        value={current}
        options={options}
        onChange={(e) => {
          const [key = '', dir] = e.target.value.split(':');
          navigate(sorting.sortTo(key, dir === 'asc' ? 'asc' : 'desc'));
        }}
      />
    </div>
  ) : null;
};

export const Table = ({ label, head, sorting, children }: TableProps) => {
  const columns = head.map(columnOf);
  return (
    <div className="flex flex-col gap-3">
      {sorting ? <MobileSort columns={columns} sorting={sorting} /> : null}
      <div className="md:border-border md:bg-surface md:overflow-x-auto md:rounded-xl md:border">
        <table aria-label={label} className="block w-full text-left text-sm md:table">
          <thead className="sr-only md:not-sr-only md:table-header-group">
            <tr>
              {columns.map((c) => (
                <HeaderCell key={c.label} column={c} sorting={sorting} />
              ))}
            </tr>
          </thead>
          <tbody className="flex flex-col gap-3 md:table-row-group">
            <Columns value={columns}>{children}</Columns>
          </tbody>
        </table>
      </div>
    </div>
  );
};

const positioned = (children: ReactNode) =>
  Children.toArray(children).map((child, i) => (
    <Position key={i} value={i}>
      {child}
    </Position>
  ));

const rowClasses =
  'border-border bg-surface flex flex-col gap-2 rounded-xl border p-4 md:table-row md:rounded-none md:border-0 md:border-b md:bg-transparent md:p-0';

export const TableRow = ({ children }: { children: ReactNode }) => (
  <tr className={classNamesOf(rowClasses, 'md:last:border-b-0')}>{positioned(children)}</tr>
);

type TableCellKind = 'text' | 'wrap' | 'numeric' | 'date' | 'actions';

const cellKindClasses: Readonly<Record<TableCellKind, string>> = {
  text: 'md:whitespace-nowrap',
  wrap: 'md:min-w-48 md:whitespace-normal',
  numeric: 'tabular-nums md:whitespace-nowrap',
  date: 'tabular-nums md:whitespace-nowrap',
  actions: 'justify-end md:w-px md:whitespace-nowrap'
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
  children,
  ...props
}: TableCellProps) => {
  const position = useContext(Position);
  const column = useContext(Columns)[position];
  const isTitle = position === 0;
  const label = isTitle || kind === 'actions' || column?.isLabelHidden ? null : column?.label;
  return (
    <td
      className={classNamesOf(
        'flex min-w-0 items-center gap-4 md:table-cell md:px-4 md:py-3 md:align-middle',
        isTitle ? 'text-base font-semibold md:text-sm md:font-normal' : 'justify-between',
        isMuted && 'text-surface-fg-muted',
        isSecondary && secondaryClasses,
        cellKindClasses[kind]
      )}
      {...props}
    >
      {label ? (
        <span className="text-surface-fg-muted shrink-0 text-xs/5 font-semibold tracking-wide uppercase md:hidden">
          {label}
        </span>
      ) : null}
      <span className={classNamesOf('min-w-0 md:contents', label && 'max-md:text-right')}>
        {children}
      </span>
    </td>
  );
};
