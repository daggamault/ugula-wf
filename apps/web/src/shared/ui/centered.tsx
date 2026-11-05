import type { ReactNode } from 'react';
import { ThemeToggle } from './theme-toggle.tsx';

export const Centered = ({ children }: { children: ReactNode }) => (
  <main className="grid min-h-dvh place-items-center p-4">
    <div className="fixed top-4 right-4">
      <ThemeToggle tooltipSide="left" />
    </div>
    {children}
  </main>
);
