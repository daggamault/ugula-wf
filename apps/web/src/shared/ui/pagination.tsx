import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useId } from 'react';
import { navigate } from '../router.tsx';
import { PAGE_SIZES, type TableState } from '../url-state.ts';
import { ButtonLink, buttonClasses } from './button.tsx';
import { NativeSelect } from './select.tsx';

export type PaginationProps = {
  label: string;
  total: number;
  state: Pick<TableState<string>, 'page' | 'pageSize' | 'pageHref' | 'sizeHref'>;
};

export const pageCount = (total: number, pageSize: number) =>
  Math.max(1, Math.ceil(total / pageSize));

export const rangeText = (page: number, pageSize: number, total: number) => {
  if (!total) return 'No results';
  const first = Math.min((page - 1) * pageSize + 1, total);
  const last = Math.min(page * pageSize, total);
  return `${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}`;
};

const Disabled = ({ children }: { children: React.ReactNode }) => (
  <span aria-disabled="true" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
    {children}
  </span>
);

export const Pagination = ({ label, total, state }: PaginationProps) => {
  const { page, pageSize, pageHref, sizeHref } = state;
  const sizeId = useId();
  const pages = pageCount(total, pageSize);
  if (pages === 1 && page === 1 && total <= PAGE_SIZES[0]) {
    return <p className="text-surface-fg-muted text-sm">{rangeText(page, pageSize, total)}</p>;
  }
  const previous = (
    <>
      <ChevronLeftIcon aria-hidden="true" className="size-4" />
      Previous
    </>
  );
  const next = (
    <>
      Next
      <ChevronRightIcon aria-hidden="true" className="size-4" />
    </>
  );
  return (
    <nav
      aria-label={`${label} pages`}
      className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-surface-fg-muted" aria-live="polite">
        {rangeText(page, pageSize, total)}
        {pages > 1 ? ` · page ${page} of ${pages}` : ''}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={sizeId} className="text-surface-fg-muted flex items-center gap-2">
          Rows
          <span className="w-20">
            <NativeSelect
              id={sizeId}
              value={String(pageSize)}
              options={PAGE_SIZES.map((s) => ({ value: String(s), label: String(s) }))}
              onChange={(e) => navigate(sizeHref(Number(e.target.value)))}
            />
          </span>
        </label>
        <div className="flex flex-1 justify-end gap-2 sm:flex-none">
          {page > 1 ? (
            <ButtonLink
              to={pageHref(Math.min(page - 1, pages))}
              variant="outline"
              size="sm"
              rel="prev"
            >
              {previous}
            </ButtonLink>
          ) : (
            <Disabled>{previous}</Disabled>
          )}
          {page < pages ? (
            <ButtonLink to={pageHref(page + 1)} variant="outline" size="sm" rel="next">
              {next}
            </ButtonLink>
          ) : (
            <Disabled>{next}</Disabled>
          )}
        </div>
      </div>
    </nav>
  );
};
