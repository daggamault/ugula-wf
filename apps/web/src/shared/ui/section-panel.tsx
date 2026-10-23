import { type ReactNode, useId } from 'react';
import { classNamesOf } from '../class-names.ts';
import type { Tone } from './tone.ts';

type SectionAccent = 'none' | 'primary' | Extract<Tone, 'warning'>;

const accentClasses: Readonly<Record<SectionAccent, string>> = {
  none: 'border-border',
  primary: 'border-primary/40 shadow-md ring-1 ring-primary/15',
  warning: 'border-warning/60 shadow-md ring-1 ring-warning/25'
};

type SectionPanelProps = {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  accent?: SectionAccent;
  children?: ReactNode;
};

export const SectionPanel = ({
  title,
  description,
  actions,
  accent = 'none',
  children
}: SectionPanelProps) => {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className={classNamesOf(
        'flex min-w-0 flex-col gap-5 rounded-xl border bg-surface p-5',
        accentClasses[accent]
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-[min(100%,18rem)] flex-1 flex-col gap-1">
          <h2 id={headingId} className="text-lg font-bold tracking-tight">
            {title}
          </h2>
          {description && <p className="text-surface-fg-muted text-sm">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children && <div className="flex min-w-0 flex-col gap-5">{children}</div>}
    </section>
  );
};

type SectionProps = {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
};

export const Section = ({ title, description, actions, children }: SectionProps) => {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={headingId} className="text-lg font-bold tracking-tight">
            {title}
          </h2>
          {description && <p className="text-surface-fg-muted text-sm">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
};
