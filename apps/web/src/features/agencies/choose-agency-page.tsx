import { Building2Icon, ChevronRightIcon, LogOutIcon } from 'lucide-react';
import type { Agency } from '../../shared/access.tsx';
import { classNamesOf } from '../../shared/class-names.ts';
import { agencyPath, Link } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { BrandHeader } from '../../shared/ui/brand.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { Card } from '../../shared/ui/card.tsx';
import { Centered } from '../../shared/ui/centered.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { interactiveClasses } from '../../shared/ui/interactive.ts';

type ChooseAgencyPageProps = {
  agencies: readonly Agency[];
  notice?: string | undefined;
  onSignOut: () => void;
};

export const ChooseAgencyPage = ({ agencies, notice, onSignOut }: ChooseAgencyPageProps) => (
  <Centered>
    <Card labelledBy="agency-heading">
      <BrandHeader id="agency-heading">Choose an Agency</BrandHeader>
      {notice ? <Alert intent="warning">{notice}</Alert> : null}
      {agencies.length ? (
        <ul className="flex flex-col gap-2">
          {agencies.map((a) => (
            <li key={a.id} className="flex">
              <Link
                to={agencyPath(a.id)}
                className={classNamesOf(
                  interactiveClasses,
                  'border-border bg-surface hover:bg-surface-hover flex min-w-0 flex-1 items-center gap-3 rounded-lg border px-4 py-3'
                )}
              >
                <Building2Icon aria-hidden="true" className="text-surface-fg-muted size-4" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold">{a.name}</span>
                  <span className="text-surface-fg-muted truncate text-xs">
                    {a.organizationName}
                  </span>
                </span>
                <ChevronRightIcon aria-hidden="true" className="text-surface-fg-muted size-4" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyText>
          You do not have access to any agency yet. Ask an administrator to invite you.
        </EmptyText>
      )}
      <Button variant="outline" isBlock onClick={onSignOut}>
        <LogOutIcon aria-hidden="true" className="size-4" />
        Sign Out
      </Button>
    </Card>
  </Centered>
);
