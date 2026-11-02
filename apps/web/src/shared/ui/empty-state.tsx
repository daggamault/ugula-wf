import {
  CircleCheckBigIcon,
  InboxIcon,
  type LucideIcon,
  SearchXIcon,
  TriangleAlertIcon
} from 'lucide-react';
import type { ReactNode } from 'react';
import { classNamesOf } from '../class-names.ts';

export const emptyValue = '—';

type EmptyStateReason = 'empty' | 'clear' | 'noMatches' | 'error';

const reasonIcons: Readonly<Record<EmptyStateReason, LucideIcon>> = {
  empty: InboxIcon,
  clear: CircleCheckBigIcon,
  noMatches: SearchXIcon,
  error: TriangleAlertIcon
};

const EmptyIcon = ({ icon: Icon, size }: { icon: LucideIcon; size: 'sm' | 'lg' }) => (
  <span
    aria-hidden="true"
    className={classNamesOf(
      'bg-surface-fg/6 text-surface-fg-muted flex shrink-0 items-center justify-center rounded-full',
      size === 'lg' ? 'size-12' : 'size-9'
    )}
  >
    <Icon className={size === 'lg' ? 'size-6' : 'size-4.5'} />
  </span>
);

type EmptyStateProps = {
  reason?: EmptyStateReason;
  title: string;
  heading?: 'h1' | 'h2' | 'h3';
  action?: ReactNode;
  children?: ReactNode;
};

export const EmptyState = ({
  reason = 'empty',
  title,
  heading: Heading = 'h2',
  action,
  children
}: EmptyStateProps) => (
  <div className="border-border flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-12 text-center">
    <EmptyIcon icon={reasonIcons[reason]} size="lg" />
    <Heading className="text-base font-bold">{title}</Heading>
    {children && <p className="text-surface-fg-muted max-w-sm text-sm">{children}</p>}
    {action && <div className="pt-2">{action}</div>}
  </div>
);

type EmptyTextProps = {
  reason?: EmptyStateReason;
  children: ReactNode;
};

export const EmptyText = ({ reason = 'empty', children }: EmptyTextProps) => (
  <div className="border-border flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center">
    <EmptyIcon icon={reasonIcons[reason]} size="sm" />
    <p className="text-surface-fg-muted text-sm">{children}</p>
  </div>
);
