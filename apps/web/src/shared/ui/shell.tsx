import { LogOutIcon, type LucideIcon, MenuIcon, XIcon } from 'lucide-react';
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { classNamesOf } from '../class-names.ts';
import { Link } from '../router.tsx';
import { Brand } from './brand.tsx';
import { Collapse } from './collapse.tsx';
import { IconButton } from './icon-button.tsx';
import { interactiveClasses } from './interactive.ts';
import { ThemeToggle } from './theme-toggle.tsx';

type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  group: string;
  active?: boolean;
  badge?: number;
};

type ShellProps = {
  path: string;
  navItems: readonly NavItem[];
  userEmail: string;
  status?: ReactNode;
  tools?: ReactNode;
  onSignOut: () => void;
  children?: ReactNode;
};

type NavMenuProps = Pick<ShellProps, 'navItems' | 'userEmail' | 'status' | 'onSignOut'>;

const groupsOf = (items: readonly NavItem[]) => {
  const groups = new Map<string, NavItem[]>();
  for (const item of items) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  return [...groups];
};

const NavHeader = ({ tools, children }: { tools?: ReactNode; children?: ReactNode }) => (
  <div className="flex h-16 shrink-0 items-center justify-between pr-3 pl-6">
    <Brand />
    <div className="flex items-center gap-2">
      {tools}
      <ThemeToggle />
      {children}
    </div>
  </div>
);

const NavMenu = ({ navItems, userEmail, status, onSignOut }: NavMenuProps) => (
  <div className="flex min-h-0 flex-1 flex-col gap-4">
    <nav aria-label="Primary" className="flex flex-1 flex-col gap-5 overflow-y-auto px-3">
      {groupsOf(navItems).map(([group, items]) => {
        const hasActive = items.some((item) => item.active);
        return (
          <div key={group} className="flex flex-col gap-1">
            <p
              className={classNamesOf(
                'flex items-center gap-1.5 px-3 pb-1 text-xs font-semibold tracking-wide uppercase',
                hasActive ? 'text-surface-fg' : 'text-surface-fg-muted'
              )}
            >
              {group}
              {hasActive ? (
                <span aria-hidden="true" className="bg-primary size-1.5 rounded-full" />
              ) : null}
            </p>
            <ul className="flex flex-col gap-1">
              {items.map(({ id, label, href, icon: Icon, active, badge }) => (
                <li key={id} className="flex">
                  <Link
                    to={href}
                    aria-current={active ? 'page' : undefined}
                    className={classNamesOf(
                      interactiveClasses,
                      'text-surface-fg-muted hover:bg-surface-fg/6 hover:text-surface-fg aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-3 text-sm font-semibold pointer-coarse:h-11'
                    )}
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    <span className="flex-1">{label}</span>
                    {badge ? (
                      <span className="bg-primary text-primary-fg min-w-5 rounded-full px-1.5 text-center text-xs/5 font-bold tabular-nums">
                        {badge}
                        <span className="sr-only"> open</span>
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
    <div className="border-border flex items-center gap-2 border-t p-3">
      {status}
      <span
        aria-hidden="true"
        className="bg-primary/15 text-primary grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold uppercase"
      >
        {userEmail.charAt(0)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={userEmail}>
        {userEmail}
      </span>
      <IconButton label="Sign Out" icon={LogOutIcon} tooltipSide="top" onClick={onSignOut} />
    </div>
  </div>
);

const TopNav = ({ path, tools, ...menu }: NavMenuProps & { path: string; tools?: ReactNode }) => {
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const isOpen = openedAt === path;
  const menuId = useId();
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenedAt(null);
    };
    const closeOutside = (event: Event) => {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) {
        setOpenedAt(null);
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOutside);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOutside);
    };
  }, [isOpen]);

  return (
    <header ref={headerRef} className="border-border bg-surface border-b lg:hidden print:hidden">
      <NavHeader tools={tools}>
        <IconButton
          label={isOpen ? 'Close Menu' : 'Open Menu'}
          icon={isOpen ? XIcon : MenuIcon}
          aria-expanded={isOpen}
          aria-controls={menuId}
          onClick={() => setOpenedAt(isOpen ? null : path)}
        />
      </NavHeader>
      <Collapse id={menuId} isOpen={isOpen}>
        <NavMenu {...menu} />
      </Collapse>
    </header>
  );
};

export const Shell = ({ path, tools, children, ...menu }: ShellProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 0 });
  }, [path]);

  return (
    <div className="flex h-dvh overflow-hidden print:block print:h-auto print:overflow-visible">
      <aside className="border-border bg-surface hidden w-72 shrink-0 flex-col border-r lg:flex print:hidden">
        <NavHeader tools={tools} />
        <NavMenu {...menu} />
      </aside>
      <div
        ref={scrollRef}
        className="relative flex min-h-0 min-w-0 flex-1 [scrollbar-gutter:stable] flex-col overflow-y-auto print:block print:overflow-visible"
      >
        <TopNav path={path} tools={tools} {...menu} />
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
};
