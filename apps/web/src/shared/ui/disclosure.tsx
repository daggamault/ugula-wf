import { ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { classNamesOf } from '../class-names.ts';
import { interactiveClasses } from './interactive.ts';

type DisclosureProps = {
  title: string;
  isPanel?: boolean | undefined;
  children: ReactNode;
};

export const Disclosure = ({ title, isPanel = false, children }: DisclosureProps) => (
  <details
    className={classNamesOf(
      'group flex min-w-0 flex-col',
      isPanel && 'bg-surface border-border rounded-xl border p-5'
    )}
  >
    <summary
      className={classNamesOf(
        interactiveClasses,
        'flex w-fit items-center gap-2 rounded-lg select-none [&::-webkit-details-marker]:hidden',
        isPanel ? 'text-base font-bold' : 'text-sm font-semibold'
      )}
    >
      <ChevronRightIcon
        aria-hidden="true"
        className="text-surface-fg-muted size-4 transition duration-150 ease-out group-open:rotate-90 motion-reduce:transition-none"
      />
      {title}
    </summary>
    <div className="flex min-w-0 flex-col gap-4 pt-4">{children}</div>
  </details>
);
