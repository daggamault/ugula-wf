import { useLayoutEffect, useRef, useState } from 'react';
import { classNamesOf } from '../class-names.ts';
import { Link } from '../router.tsx';
import { interactiveClasses } from './interactive.ts';

type TabLink = {
  label: string;
  href: string;
  isSelected: boolean;
  count?: number | undefined;
};

type Indicator = { left: number; width: number };

export const Tabs = ({ label, tabs }: { label: string; tabs: readonly TabLink[] }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<Indicator | null>(null);
  const selected = tabs.findIndex((t) => t.isSelected);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const current = track.querySelector<HTMLElement>('[aria-current="page"]');
      setIndicator(current ? { left: current.offsetLeft, width: current.offsetWidth } : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [selected, tabs]);

  return (
    <nav aria-label={label} className="flex max-w-full overflow-x-auto">
      <div
        ref={trackRef}
        className="bg-surface-fg/5 ring-border/70 relative flex gap-1 rounded-full p-1 ring-1 ring-inset"
      >
        {indicator ? (
          <span
            aria-hidden="true"
            className="bg-primary absolute inset-y-1 left-0 rounded-full transition-[translate,width] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
            style={{ width: indicator.width, translate: `${indicator.left}px 0` }}
          />
        ) : null}
        {tabs.map((t) => (
          <Link
            key={t.label}
            to={t.href}
            aria-current={t.isSelected ? 'page' : undefined}
            className={classNamesOf(
              interactiveClasses,
              'text-surface-fg-muted relative flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold whitespace-nowrap',
              'not-aria-[current=page]:hover:bg-surface-fg/6 not-aria-[current=page]:hover:text-surface-fg aria-[current=page]:text-primary-fg',
              indicator ? null : 'aria-[current=page]:bg-primary'
            )}
          >
            {t.label}
            {t.count ? (
              <span
                className={classNamesOf(
                  'rounded-full px-1.5 text-xs/5 tabular-nums transition-colors duration-150 ease-out',
                  t.isSelected ? 'bg-primary-fg/20' : 'bg-surface-fg/8'
                )}
              >
                {t.count}
              </span>
            ) : null}
          </Link>
        ))}
      </div>
    </nav>
  );
};
