import { MoonIcon, SunIcon } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { IconButton } from './icon-button.tsx';
import type { TooltipSide } from './tooltip.tsx';

type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'ugula_theme';

const readDocumentTheme = (): Theme =>
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

const applyDocumentTheme = (theme: Theme) => {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
};

export const ThemeToggle = ({ tooltipSide = 'bottom' }: { tooltipSide?: TooltipSide }) => {
  const isDark = useDocumentTheme() === 'dark';
  return (
    <IconButton
      label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      icon={isDark ? SunIcon : MoonIcon}
      tooltipSide={tooltipSide}
      onClick={() => applyDocumentTheme(isDark ? 'light' : 'dark')}
    />
  );
};
