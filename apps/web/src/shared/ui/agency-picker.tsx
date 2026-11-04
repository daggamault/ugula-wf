import { Building2Icon, CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { Agency } from '../access.tsx';
import { classNamesOf } from '../class-names.ts';
import { agencyPath, navigate } from '../router.tsx';
import { interactiveClasses } from './interactive.ts';
import { hidePopover } from './popover.ts';

type AgencyPickerProps = {
  agencies: readonly Agency[];
  current: { id: string; name: string; organizationName: string };
};

export const AgencyPicker = ({ agencies, current }: AgencyPickerProps) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = `agencies-${useId().replace(/[^\w-]/g, '')}`;
  const anchorName = `--${panelId}`;
  const [q, setQ] = useState('');
  const shown = agencies.filter((a) =>
    `${a.name} ${a.organizationName}`.toLowerCase().includes(q.trim().toLowerCase())
  );
  const choose = (agency: Agency) => {
    hidePopover(panelRef.current);
    if (agency.id !== current.id) navigate(agencyPath(agency.id, '/claims'));
  };
  return (
    <div className="flex" style={{ anchorName }}>
      <button
        type="button"
        popoverTarget={panelId}
        disabled={agencies.length < 2}
        className={classNamesOf(
          interactiveClasses,
          'border-border bg-surface enabled:hover:bg-surface-hover flex h-12 min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 text-left transition duration-150 ease-out enabled:cursor-pointer'
        )}
      >
        <Building2Icon aria-hidden="true" className="text-surface-fg-muted size-4 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold">{current.name}</span>
          <span className="text-surface-fg-muted truncate text-xs">{current.organizationName}</span>
        </span>
        {agencies.length > 1 ? (
          <ChevronsUpDownIcon
            aria-hidden="true"
            className="text-surface-fg-muted size-4 shrink-0"
          />
        ) : null}
        <span className="sr-only">Switch agency</span>
      </button>
      <div
        ref={panelRef}
        id={panelId}
        popover="auto"
        role="dialog"
        aria-label="Agencies"
        style={{ positionAnchor: anchorName }}
        className="bg-surface text-surface-fg border-border inset-auto m-2 max-h-[min(28rem,70vh)] w-72 scale-95 overflow-y-auto rounded-xl border p-2 opacity-0 shadow-lg transition-[opacity,scale,display,overlay] transition-discrete duration-200 ease-out [position-area:bottom_span-right] open:scale-100 open:opacity-100 starting:open:scale-95 starting:open:opacity-0"
      >
        {agencies.length > 6 ? (
          <input
            type="search"
            aria-label="Find an agency"
            placeholder="Find an agency"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className={classNamesOf(
              interactiveClasses,
              'border-border bg-surface mb-2 h-10 w-full rounded-lg border px-3 text-sm'
            )}
          />
        ) : null}
        <ul className="flex flex-col gap-1">
          {shown.map((a) => (
            <li key={a.id} className="flex">
              <button
                type="button"
                onClick={() => choose(a)}
                aria-current={a.id === current.id ? 'true' : undefined}
                className={classNamesOf(
                  interactiveClasses,
                  'hover:bg-surface-fg/6 aria-[current=true]:bg-primary/10 aria-[current=true]:text-primary flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left transition duration-150 ease-out'
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold">{a.name}</span>
                  <span className="text-surface-fg-muted truncate text-xs">
                    {a.organizationName}
                  </span>
                </span>
                {a.id === current.id ? (
                  <CheckIcon aria-hidden="true" className="size-4 shrink-0" />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
