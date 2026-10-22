import type { ReactNode } from 'react';
import { Button } from './button.tsx';
import { ThemeToggle } from './theme-toggle.tsx';

export type NavItem = {
  id: string;
  label: string;
  active?: boolean;
  onSelect?: () => void;
};

export type ShellProps = {
  title: string;
  navItems: readonly NavItem[];
  userEmail: string;
  status?: ReactNode;
  onSignOut: () => void;
  children?: ReactNode;
};

export const Shell = ({ title, navItems, userEmail, status, onSignOut, children }: ShellProps) => (
  <div className="flex min-h-dvh flex-col bg-neutral-50 md:h-dvh md:flex-row md:overflow-hidden dark:bg-neutral-950">
    <aside className="flex w-full shrink-0 flex-col border-b border-neutral-200 bg-white md:w-72 md:border-r md:border-b-0 dark:border-neutral-800 dark:bg-neutral-900">
      <header className="flex h-16 shrink-0 items-center justify-between pr-3 pl-6">
        <span className="text-2xl font-extrabold tracking-tight text-neutral-950 select-none dark:text-neutral-50">
          ugula
        </span>
        <ThemeToggle />
      </header>

      <nav
        aria-label="Primary"
        className="flex flex-1 gap-1 overflow-x-auto px-3 py-2 md:flex-col md:overflow-y-auto"
      >
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={item.active ? 'page' : undefined}
            onClick={item.onSelect}
            className={`focus-visible:ring-primary-500 flex shrink-0 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none ${
              item.active
                ? 'bg-primary-900/8 text-primary-950 dark:bg-primary-50/10 dark:text-primary-50'
                : 'hover:bg-primary-900/5 hover:text-primary-950 dark:hover:bg-primary-50/6 dark:hover:text-primary-50 text-neutral-500 dark:text-neutral-400'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <footer className="flex flex-col gap-3 border-t border-neutral-200 p-3 dark:border-neutral-800">
        <div className="flex items-center justify-between gap-2 px-1">
          <span
            className="truncate text-xs font-semibold text-neutral-600 dark:text-neutral-400"
            title={userEmail}
          >
            {userEmail}
          </span>
          {status}
        </div>
        <Button intent="danger" onClick={onSignOut}>
          Sign out
        </Button>
      </footer>
    </aside>

    <main className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6 lg:p-10">
      <h1 className="border-b border-neutral-200 pb-4 text-xl font-extrabold tracking-tight text-neutral-950 sm:text-2xl dark:border-neutral-800 dark:text-neutral-50">
        {title}
      </h1>
      {children}
    </main>
  </div>
);
