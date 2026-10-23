import { classNamesOf } from '../class-names.ts';
import { Link } from '../router.tsx';
import { interactiveClasses } from './interactive.ts';

type FilterPillOption = {
  label: string;
  href: string;
  isSelected: boolean;
};

type FilterPillsProps = {
  label: string;
  options: readonly FilterPillOption[];
};

export const FilterPills = ({ label, options }: FilterPillsProps) => (
  <nav aria-label={label} className="flex flex-wrap gap-1">
    {options.map(({ label: optionLabel, href, isSelected }) => (
      <Link
        key={optionLabel}
        to={href}
        aria-current={isSelected ? 'true' : undefined}
        className={classNamesOf(
          interactiveClasses,
          'border-border text-surface-fg-muted hover:bg-surface-fg/6 hover:text-surface-fg aria-[current=true]:border-primary/40 aria-[current=true]:bg-primary/10 aria-[current=true]:text-primary rounded-full border px-3 py-1 text-xs font-semibold'
        )}
      >
        {optionLabel}
      </Link>
    ))}
  </nav>
);
