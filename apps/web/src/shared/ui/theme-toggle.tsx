import { MoonIcon, SunIcon } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { IconButton } from './icon-button.tsx';
import type { TooltipSide } from './tooltip.tsx';

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

const subscribeTheme = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
};

export const useDocumentTheme = () =>
  useSyncExternalStore(subscribeTheme, readDocumentTheme, (): Theme => 'light');

export const applyDocumentTheme = (theme: Theme) => {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
};

export type ThemeToggleProps = {
  initialTheme?: Theme;
  onToggle?: (next: Theme) => void;
  tooltipSide?: TooltipSide;
};

export const ThemeToggle = ({
  initialTheme,
  onToggle,
  tooltipSide = 'bottom'
}: ThemeToggleProps) => {
  const [theme, setTheme] = useState<Theme>(() => initialTheme ?? readDocumentTheme());
  const isDark = theme === 'dark';

  return (
    <IconButton
      label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      icon={isDark ? SunIcon : MoonIcon}
      tooltipSide={tooltipSide}
      onClick={() => {
        const next: Theme = isDark ? 'light' : 'dark';
        setTheme(next);
        applyDocumentTheme(next);
        onToggle?.(next);
      }}
    />
  );
};
