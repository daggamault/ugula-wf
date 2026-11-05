import type { ReactNode } from 'react';

const widthClasses = { md: 'sm:w-96', lg: 'sm:w-[32rem]' } as const;

type DrawerProps = { width: keyof typeof widthClasses; children: ReactNode };

export const Drawer = ({ width, children }: DrawerProps) => (
  <div
    className={`border-border bg-surface absolute inset-y-0 right-0 z-10 flex w-full flex-col border-l shadow-lg transition-[opacity,translate] duration-200 ease-out ${widthClasses[width]} starting:translate-x-4 starting:opacity-0`}
  >
    {children}
  </div>
);
