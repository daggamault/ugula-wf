import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  type LucideIcon
} from 'lucide-react';
import { useId } from 'react';
import { navigate } from '../router.tsx';
import { PAGE_SIZES, type TableState } from '../url-state.ts';
import { IconButton, IconLink } from './icon-button.tsx';
import { NativeSelect } from './select.tsx';

export type PaginationProps = {
  label: string;
  total: number;
  state: Pick<TableState<string>, 'page' | 'pageSize' | 'pageHref'> &
    Partial<Pick<TableState<string>, 'sizeHref'>>;
};

export const pageCount = (total: number, pageSize: number) =>
  Math.max(1, Math.ceil(total / pageSize));

export const rangeText = (page: number, pageSize: number, total: number) => {
  if (!total) return 'No results';
  const first = Math.min((page - 1) * pageSize + 1, total);
  const last = Math.min(page * pageSize, total);
  return `${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}`;
};

const PageLink = ({
  to,
  rel,
  label,
  icon,
  disabledReason
}: {
  to: string;
  rel?: string;
  label: string;
  icon: LucideIcon;
  disabledReason: string | undefined;
}) =>
  disabledReason === undefined ? (
    <IconLink to={to} label={label} icon={icon} {...(rel ? { rel } : {})} />
  ) : (
    <IconButton label={label} icon={icon} disabledReason={disabledReason} />
  );

export const Pagination = ({ label, total, state }: PaginationProps) => {
  const { page, pageSize, pageHref, sizeHref } = state;
  const sizeId = useId();
  const pages = pageCount(total, pageSize);
  if (pages === 1 && page === 1 && total <= PAGE_SIZES[0]) {
    return <p className="text-surface-fg-muted text-sm">{rangeText(page, pageSize, total)}</p>;
  }
  const isFirst = page <= 1;
  const isLast = page >= pages;
  const onFirst = isFirst ? 'Already on the first page' : undefined;
  const onLast = isLast ? 'Already on the last page' : undefined;
  return (
    <nav
      aria-label={`${label} pages`}
      className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-surface-fg-muted" aria-live="polite">
        {rangeText(page, pageSize, total)}
        {pages > 1 ? ` · Page ${page.toLocaleString()} of ${pages.toLocaleString()}` : ''}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
        {sizeHref ? (
          <label htmlFor={sizeId} className="text-surface-fg-muted flex items-center gap-2">
            Rows Per Page
            <span className="w-20">
              <NativeSelect
                id={sizeId}
                value={String(pageSize)}
                options={PAGE_SIZES.map((s) => ({ value: String(s), label: String(s) }))}
                onChange={(e) => navigate(sizeHref(Number(e.target.value)))}
              />
            </span>
          </label>
        ) : null}
        <div className="flex items-center gap-1">
          <PageLink
            to={pageHref(1)}
            label="First Page"
            icon={ChevronsLeftIcon}
            disabledReason={onFirst}
          />
          <PageLink
            to={pageHref(Math.min(page - 1, pages))}
            rel="prev"
            label="Previous Page"
            icon={ChevronLeftIcon}
            disabledReason={onFirst}
          />
          <PageLink
            to={pageHref(page + 1)}
            rel="next"
            label="Next Page"
            icon={ChevronRightIcon}
            disabledReason={onLast}
          />
          <PageLink
            to={pageHref(pages)}
            label="Last Page"
            icon={ChevronsRightIcon}
            disabledReason={onLast}
          />
        </div>
      </div>
    </nav>
  );
};
