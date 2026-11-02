import type { ReactNode } from 'react';
import { classNamesOf } from '../class-names.ts';

type CollapseProps = { id: string; isOpen: boolean; children: ReactNode };

export const Collapse = ({ id, isOpen, children }: CollapseProps) => (
  <div
    id={id}
    inert={!isOpen}
    className={classNamesOf(
      'grid transition-[grid-template-rows,opacity] duration-300 ease-out',
      isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
    )}
  >
    <div className="min-h-0 overflow-hidden">{children}</div>
  </div>
);
