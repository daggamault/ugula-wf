import { ArrowLeftIcon } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { classNamesOf } from '../class-names.ts';
import { EmptyState } from './empty-state.tsx';
import { IconLink } from './icon-button.tsx';
import { Spinner } from './spinner.tsx';

export type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  backTo?: string | undefined;
  backLabel?: string;
  actions?: ReactNode;
};

export const PageHeader = ({
  title,
  description,
  backTo,
  backLabel = 'Back',
  actions
}: PageHeaderProps) => {
  const headerRef = useRef<HTMLElement>(null);
  const [isStuck, setIsStuck] = useState(false);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setIsStuck(Boolean(entry && entry.intersectionRatio < 1)),
      { threshold: 1 }
    );
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  return (
    <header
      ref={headerRef}
      className={classNamesOf(
        'sticky -top-px z-10 -mx-4 -mt-4 flex flex-wrap items-center print:hidden justify-between gap-4 border-b px-4 pt-4 pb-3 transition-colors duration-150 ease-out sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-6 lg:-mx-10 lg:-mt-10 lg:px-10 lg:pt-10',
        isStuck ? 'border-border bg-canvas/75 backdrop-blur-md' : 'border-transparent'
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        {backTo && <IconLink to={backTo} label={backLabel} icon={ArrowLeftIcon} />}
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl/9 font-extrabold tracking-tight text-balance break-words">
            {title}
          </h1>
          {description && <div className="text-surface-fg-muted text-sm">{description}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
};

export type PageProps = PageHeaderProps & {
  children?: ReactNode;
};

export const Page = ({ children, ...header }: PageProps) => (
  <section className="flex flex-col gap-6 p-4 sm:p-6 lg:p-10 print:p-0">
    <PageHeader {...header} />
    {children}
  </section>
);

export const WorkspaceHeader = ({
  title,
  description,
  backTo,
  backLabel = 'Back',
  actions,
  breadcrumbs
}: PageHeaderProps & { breadcrumbs?: ReactNode }) => (
  <header className="border-border bg-surface flex flex-wrap items-center justify-between gap-4 border-b px-4 py-3">
    <div className="flex min-w-0 flex-col gap-1">
      {breadcrumbs}
      <div className="flex min-w-0 items-start gap-2">
        {backTo && <IconLink to={backTo} label={backLabel} icon={ArrowLeftIcon} />}
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl/9 font-extrabold tracking-tight">
            {title}
          </h1>
          {description && <div className="text-surface-fg-muted text-sm">{description}</div>}
        </div>
      </div>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>
);

export const PageLoading = () => (
  <div className="flex flex-1 justify-center py-16">
    <Spinner />
  </div>
);

export const PageFailure = ({ message }: { message: string }) => (
  <div className="p-4 sm:p-6 lg:p-10">
    <EmptyState reason="error" title="Something Went Wrong" heading="h1">
      {message}
    </EmptyState>
  </div>
);
