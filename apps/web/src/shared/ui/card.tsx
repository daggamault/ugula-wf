import type { ReactNode } from 'react';

type CardProps = { labelledBy: string; children: ReactNode };

export const Card = ({ labelledBy, children }: CardProps) => (
  <section
    aria-labelledby={labelledBy}
    className="border-border bg-surface flex w-full max-w-sm flex-col gap-6 rounded-2xl border p-7 transition duration-300 ease-out starting:scale-95 starting:opacity-0"
  >
    {children}
  </section>
);
