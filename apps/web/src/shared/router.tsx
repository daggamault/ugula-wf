import { type AnchorHTMLAttributes, type MouseEvent, useEffect, useSyncExternalStore } from 'react';

type Guard = { params: readonly string[] };

const listeners = new Set<() => void>();
const guards = new Set<Guard>();
let shown = '';
let pending: string | null = null;

const current = () => `${window.location.pathname}${window.location.search}`;

const emit = () => {
  for (const listener of listeners) listener();
};

const isLeaving = (from: string, to: string) => {
  const a = new URL(from, 'http://local');
  const b = new URL(to, 'http://local');
  return (
    a.pathname !== b.pathname ||
    [...guards].some((g) => g.params.some((p) => a.searchParams.get(p) !== b.searchParams.get(p)))
  );
};

const hold = (to: string) => {
  pending = to;
  emit();
};

const onPop = () => {
  const to = current();
  if (guards.size && isLeaving(shown, to)) {
    window.history.pushState(null, '', shown);
    hold(to);
    return;
  }
  shown = to;
  pending = null;
  emit();
};

const onUnload = (e: Event) => e.preventDefault();

let isListening = false;

const listen = () => {
  if (isListening) return;
  isListening = true;
  shown = current();
  window.addEventListener('popstate', onPop);
};

const subscribe = (listener: () => void) => {
  listen();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const AGENCY_PATH =
  /^\/agencies\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\/|$)/i;

export const agencyOfPath = (pathname: string) => pathname.match(AGENCY_PATH)?.[1] ?? null;

export const currentAgency = () =>
  typeof window === 'undefined' ? null : agencyOfPath(window.location.pathname);

export const agencyPath = (agencyId: string, to = '/') =>
  `/agencies/${agencyId}${to === '/' ? '' : to}`;

export const agencyHref = (to: string, agencyId = currentAgency()) =>
  agencyId && to.startsWith('/') && !to.startsWith('/agencies') ? agencyPath(agencyId, to) : to;

export const navigate = (to: string, { replace = false, force = false } = {}) => {
  const href = agencyHref(to);
  if (!force && guards.size && isLeaving(current(), href)) {
    hold(href);
    return;
  }
  if (replace) window.history.replaceState(null, '', href);
  else window.history.pushState(null, '', href);
  shown = current();
  pending = null;
  emit();
};

export const guardChanges = (params: readonly string[]) => {
  const guard = { params };
  listen();
  if (!guards.size) window.addEventListener('beforeunload', onUnload);
  guards.add(guard);
  return () => {
    guards.delete(guard);
    if (!guards.size) window.removeEventListener('beforeunload', onUnload);
  };
};

const PATH_ONLY: readonly string[] = [];

export const useUnsavedChanges = (dirty: boolean, params = PATH_ONLY) =>
  useEffect(() => (dirty ? guardChanges(params) : undefined), [dirty, params]);

export const usePendingLeave = () =>
  useSyncExternalStore(
    subscribe,
    () => pending,
    () => null
  );

export const stay = () => {
  pending = null;
  emit();
};

export const discard = () => {
  if (pending !== null) navigate(pending, { force: true });
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

const decoded = (part: string) => {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
};

export const matchPath = (pattern: string, path: string): Record<string, string> | null => {
  const want = pattern.split('/').filter(Boolean);
  const have = path.split('/').filter(Boolean);
  if (want.length !== have.length) return null;
  const params: Record<string, string> = {};
  for (const [i, part] of want.entries()) {
    const actual = have[i] ?? '';
    if (part.startsWith(':')) {
      const value = decoded(actual);
      if (value === null) return null;
      params[part.slice(1)] = value;
    } else if (part !== actual) return null;
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
