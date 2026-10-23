import type { ReactNode } from 'react';

export const Brand = () => (
  <span className="text-2xl font-extrabold tracking-tight select-none sm:text-3xl">ugula</span>
);

export const BrandHeader = ({ id, children }: { id?: string; children: ReactNode }) => (
  <header className="flex flex-col gap-2">
    <h1 id={id}>
      <Brand />
    </h1>
    <p className="text-surface-fg-muted text-sm">{children}</p>
  </header>
);
