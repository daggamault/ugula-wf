import { type AnchorHTMLAttributes, type MouseEvent, useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
};

const current = () => `${window.location.pathname}${window.location.search}`;

const AGENCY_PATH =
  /^\/agencies\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\/|$)/i;

export const agencyOfPath = (pathname: string) => pathname.match(AGENCY_PATH)?.[1] ?? null;

export const currentAgency = () =>
  typeof window === 'undefined' ? null : agencyOfPath(window.location.pathname);

export const agencyPath = (agencyId: string, to = '/') =>
  `/agencies/${agencyId}${to === '/' ? '' : to}`;

export const agencyHref = (to: string, agencyId = currentAgency()) =>
  agencyId && to.startsWith('/') && !to.startsWith('/agencies') ? agencyPath(agencyId, to) : to;

export const navigate = (to: string, { replace = false } = {}) => {
  const href = agencyHref(to);
  if (replace) window.history.replaceState(null, '', href);
  else window.history.pushState(null, '', href);
  for (const listener of listeners) listener();
};

export const useLocation = (fallback = '/') => {
  const href = useSyncExternalStore(subscribe, current, () => fallback);
  const url = new URL(href, 'http://local');
  return {
    path: url.pathname.replace(AGENCY_PATH, '') || '/',
    query: url.searchParams,
    agencyId: agencyOfPath(url.pathname)
  };
};

export const matchPath = (pattern: string, path: string): Record<string, string> | null => {
  const want = pattern.split('/').filter(Boolean);
  const have = path.split('/').filter(Boolean);
  if (want.length !== have.length) return null;
  const params: Record<string, string> = {};
  for (const [i, part] of want.entries()) {
    const actual = have[i] ?? '';
    if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(actual);
    else if (part !== actual) return null;
  }
  return params;
};

export type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string };

export const Link = ({ to, onClick, ...rest }: LinkProps) => (
  <a
    href={agencyHref(to)}
    onClick={(e: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      navigate(to);
    }}
    {...rest}
  />
);
