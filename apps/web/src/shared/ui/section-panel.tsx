import { type ReactNode, useId } from 'react';
import { classNamesOf } from '../class-names.ts';
import type { Intent } from './intent.ts';

type SectionAccent = Extract<Intent, 'primary' | 'warning'> | 'custom';

const accentClasses: Readonly<Record<SectionAccent, string>> = {
  primary: 'border-primary/40 ring-primary/15 ring-1',
  warning: 'border-warning/60 ring-warning/25 ring-1',
  custom: 'border-custom/40 ring-custom/15 ring-1'
};

type SectionPanelProps = {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  accent?: SectionAccent | undefined;
  children?: ReactNode;
};

export const SectionPanel = ({
  title,
  description,
  actions,
  accent,
  children
}: SectionPanelProps) => {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className={classNamesOf(
        'bg-surface flex min-w-0 flex-col gap-4 rounded-xl border p-5',
        accent ? accentClasses[accent] : 'border-border'
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-[min(100%,18rem)] flex-1 flex-col gap-1">
          <h2 id={headingId} className="text-base font-bold">
            {title}
          </h2>
          {description && <p className="text-surface-fg-muted text-sm">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children && <div className="flex min-w-0 flex-col gap-4">{children}</div>}
    </section>
  );
};

type SectionProps = {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
};

export const Section = ({ title, description, actions, children }: SectionProps) => {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={headingId} className="text-base font-bold">
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
