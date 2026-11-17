import type { ReactNode } from 'react';

export const Brand = () => (
  <span className="text-2xl font-extrabold tracking-tight select-none sm:text-3xl">ugula</span>
);

type BrandHeaderProps = { id?: string; description?: string; children: ReactNode };

export const BrandHeader = ({ id, description, children }: BrandHeaderProps) => (
  <header className="flex flex-col gap-2">
    <Brand />
    <h1 id={id} className="text-base font-bold">
      {children}
    </h1>
    {description ? <p className="text-surface-fg-muted text-sm">{description}</p> : null}
  </header>
);
