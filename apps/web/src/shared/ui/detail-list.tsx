import type { ReactNode } from 'react';
import { classNamesOf } from '../class-names.ts';
import { emptyValue } from './empty-state.tsx';

export const DetailList = ({ children }: { children: ReactNode }) => (
  <dl className="@container">
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 @md:grid-cols-2 @2xl:grid-cols-4">
      {children}
    </div>
  </dl>
);

type DetailProps = {
  label: string;
  isMonospace?: boolean;
  isEmphasized?: boolean;
  children: ReactNode;
};

export const Detail = ({
  label,
  isMonospace = false,
  isEmphasized = false,
  children
}: DetailProps) => (
  <div className="flex min-w-0 flex-col gap-1">
    <dt className="text-surface-fg-muted text-sm font-medium">{label}</dt>
    <dd
      className={classNamesOf(
        'flex min-h-5 items-center break-words',
        isEmphasized
          ? 'font-bold text-xl tabular-nums tracking-tight'
          : isMonospace && children !== emptyValue
            ? 'font-mono text-xs'
            : 'text-sm'
      )}
    >
      {children}
    </dd>
  </div>
);
