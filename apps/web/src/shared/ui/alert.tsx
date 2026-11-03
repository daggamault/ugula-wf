import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  type LucideIcon,
  TriangleAlertIcon
} from 'lucide-react';
import type { ReactNode } from 'react';
import { classNamesOf } from '../class-names.ts';
import type { Intent } from './intent.ts';

const intentClasses: Readonly<Record<Intent, string>> = {
  primary: 'border-primary/30 bg-primary/10',
  success: 'border-success/30 bg-success/10',
  info: 'border-info/30 bg-info/10',
  warning: 'border-warning/30 bg-warning/10 text-warning-fg',
  danger: 'border-danger/30 bg-danger/10 text-danger'
};

const iconClasses: Readonly<Record<Intent, string>> = {
  primary: 'text-primary',
  success: 'text-success',
  info: 'text-info',
  warning: '',
  danger: ''
};

export const intentIcons: Readonly<Record<Intent, LucideIcon>> = {
  primary: InfoIcon,
  success: CircleCheckIcon,
  info: InfoIcon,
  warning: TriangleAlertIcon,
  danger: CircleAlertIcon
};

type AlertProps = {
  intent?: Intent;
  action?: ReactNode;
  children: ReactNode;
};

export const Alert = ({ intent = 'danger', action, children }: AlertProps) => {
  const Icon = intentIcons[intent];
  return (
    <div
      role={intent === 'danger' ? 'alert' : 'status'}
      className={classNamesOf(
        'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border px-4 py-3 text-sm',
        intentClasses[intent]
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex h-5 shrink-0 items-center">
          <Icon aria-hidden="true" className={classNamesOf('size-4', iconClasses[intent])} />
        </span>
        <div className="min-w-0">{children}</div>
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
};

type AlertItem = { label?: string | undefined; text: string };

export const AlertList = ({
  intent,
  title,
  items
}: {
  intent: Intent;
  title: string;
  items: readonly AlertItem[];
}) => (
  <Alert intent={intent}>
    <span className="flex flex-col gap-1">
      <strong className="font-semibold">{title}</strong>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={`${item.label ?? ''}:${item.text}`}>
            {item.label ? <span className="font-semibold">{item.label}: </span> : null}
            {item.text}
          </li>
        ))}
      </ul>
    </span>
  </Alert>
);
