import type { ReactNode } from 'react';
import { classNamesOf } from '../class-names.ts';

export const DetailList = ({ children }: { children: ReactNode }) => (
  <div className="@container">
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 @md:grid-cols-2 @2xl:grid-cols-4">
      {children}
    </dl>
  </div>
);

type DetailProps = {
  label: string;
  isEmphasized?: boolean;
  children: ReactNode;
};

export const Detail = ({ label, isEmphasized = false, children }: DetailProps) => (
  <div className="flex min-w-0 flex-col gap-1">
    <dt className="text-surface-fg-muted text-sm font-medium">{label}</dt>
    <dd
      className={classNamesOf(
        'break-words',
        isEmphasized ? 'text-xl font-bold tracking-tight tabular-nums' : 'text-sm'
      )}
    >
      {children}
    </dd>
  </div>
);
