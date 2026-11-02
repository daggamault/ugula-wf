import { ChevronRightIcon } from 'lucide-react';
import { classNamesOf } from '../class-names.ts';
import { Link } from '../router.tsx';
import { interactiveClasses } from './interactive.ts';

export type Crumb = { label: string; to?: string; onSelect?: () => void };

const crumbClasses = classNamesOf(
  interactiveClasses,
  'hover:bg-surface-fg/6 hover:text-surface-fg rounded-lg px-1.5 py-0.5'
);

export const Breadcrumbs = ({ label, crumbs }: { label: string; crumbs: readonly Crumb[] }) => (
  <nav aria-label={label}>
    <ol className="text-surface-fg-muted flex flex-wrap items-center gap-0.5 text-xs font-semibold">
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <li key={`${i}-${c.label}`} className="flex items-center gap-0.5">
            {i ? <ChevronRightIcon aria-hidden="true" className="size-3.5" /> : null}
            {isLast ? (
              <span aria-current="page" className="text-surface-fg px-1.5 py-0.5">
                {c.label}
              </span>
            ) : c.to ? (
              <Link to={c.to} className={crumbClasses}>
                {c.label}
              </Link>
            ) : (
              <button type="button" className={crumbClasses} onClick={c.onSelect}>
                {c.label}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  </nav>
);
