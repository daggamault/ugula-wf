import { classNamesOf } from '../class-names.ts';
import { Link } from '../router.tsx';
import { interactiveClasses } from './interactive.ts';

export type TabLink = {
  label: string;
  href: string;
  isSelected: boolean;
  count?: number | undefined;
};

export const Tabs = ({ label, tabs }: { label: string; tabs: readonly TabLink[] }) => (
  <nav aria-label={label} className="border-border -mb-2 flex gap-1 overflow-x-auto border-b">
    {tabs.map((t) => (
      <Link
        key={t.label}
        to={t.href}
        aria-current={t.isSelected ? 'page' : undefined}
        className={classNamesOf(
          interactiveClasses,
          'text-surface-fg-muted hover:text-surface-fg aria-[current=page]:border-primary aria-[current=page]:text-primary -mb-px flex items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm font-semibold whitespace-nowrap'
        )}
      >
        {t.label}
        {t.count ? (
          <span className="bg-surface-fg/8 rounded-full px-1.5 text-xs/5 tabular-nums">
            {t.count}
          </span>
        ) : null}
      </Link>
    ))}
  </nav>
);
