import { useState } from 'react';

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'ugula_theme';

export const resolveInitialTheme = (stored: string | null, prefersDark: boolean): Theme => {
  if (stored === 'light' || stored === 'dark') return stored;
  return prefersDark ? 'dark' : 'light';
};

export const readDocumentTheme = (): Theme =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'light';

export const applyDocumentTheme = (theme: Theme) => {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
};

export type ThemeToggleProps = {
  initialTheme?: Theme;
  onToggle?: (next: Theme) => void;
};

export const ThemeToggle = ({ initialTheme, onToggle }: ThemeToggleProps) => {
  const [theme, setTheme] = useState<Theme>(() => initialTheme ?? readDocumentTheme());
  const isDark = theme === 'dark';
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  const handleClick = () => {
    const next: Theme = isDark ? 'light' : 'dark';
    setTheme(next);
    applyDocumentTheme(next);
    onToggle?.(next);
  };

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={handleClick}
      className="focus-visible:ring-primary-500 hover:bg-primary-900/6 dark:hover:bg-primary-50/10 inline-grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-neutral-500 transition-all duration-150 hover:text-neutral-950 focus-visible:ring-2 focus-visible:outline-none active:scale-95 dark:text-neutral-400 dark:hover:text-neutral-50"
    >
      {isDark ? (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-4.5"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-4.5"
        >
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      )}
    </button>
  );
};
