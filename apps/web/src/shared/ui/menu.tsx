import { ChevronDownIcon, type LucideIcon } from 'lucide-react';
import { useId, useRef } from 'react';
import { classNamesOf } from '../class-names.ts';
import { buttonClasses } from './button.tsx';
import { interactiveClasses } from './interactive.ts';
import { hidePopover } from './popover.ts';
import { PendingOverlay } from './spinner.tsx';

export type MenuItem = {
  label: string;
  description: string;
  icon: LucideIcon;
  disabledReason?: string | undefined;
  onSelect: () => void;
};

export type MenuGroup = { label: string; items: readonly MenuItem[] };

export const Menu = ({
  label,
  icon: Icon,
  groups,
  isPending = false
}: {
  label: string;
  icon: LucideIcon;
  groups: readonly MenuGroup[];
  isPending?: boolean;
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = `menu-${useId().replace(/[^\w-]/g, '')}`;
  const anchorName = `--${panelId}`;
  return (
    <div className="flex" style={{ anchorName }}>
      <button
        type="button"
        popoverTarget={panelId}
        aria-haspopup="menu"
        aria-busy={isPending || undefined}
        disabled={isPending}
        className={classNamesOf(buttonClasses(), 'cursor-pointer')}
      >
        <Icon aria-hidden="true" className="size-4" />
        {label}
        <ChevronDownIcon aria-hidden="true" className="size-4" />
        {isPending ? <PendingOverlay /> : null}
      </button>
      <div
        ref={panelRef}
        id={panelId}
        popover="auto"
        role="menu"
        aria-label={label}
        style={{ positionAnchor: anchorName }}
        className="bg-surface text-surface-fg border-border inset-auto m-2 max-h-[min(32rem,75vh)] w-80 scale-95 overflow-y-auto rounded-xl border p-2 opacity-0 shadow-lg transition-[opacity,scale,display,overlay] transition-discrete duration-200 ease-out [position-area:bottom_span-left] open:scale-100 open:opacity-100 starting:open:scale-95 starting:open:opacity-0"
      >
        {groups.map((group, g) => (
          <fieldset
            key={group.label}
            className={classNamesOf(
              'flex flex-col gap-1',
              g > 0 && 'border-border mt-2 border-t pt-2'
            )}
          >
            <legend className="text-surface-fg-muted px-3 py-1 text-xs font-semibold tracking-wide uppercase">
              {group.label}
            </legend>
            {group.items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                aria-disabled={item.disabledReason ? true : undefined}
                onClick={() => {
                  if (item.disabledReason) return;
                  hidePopover(panelRef.current);
                  item.onSelect();
                }}
                className={classNamesOf(
                  interactiveClasses,
                  'not-aria-disabled:hover:bg-surface-fg/6 flex items-start gap-2 rounded-lg px-3 py-2 text-left not-aria-disabled:cursor-pointer aria-disabled:opacity-50'
                )}
              >
                <span className="flex h-5 items-center">
                  <item.icon aria-hidden="true" className="size-4 shrink-0" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-semibold">{item.label}</span>
                  <span className="text-surface-fg-muted text-xs">
                    {item.disabledReason ?? item.description}
                  </span>
                </span>
              </button>
            ))}
          </fieldset>
        ))}
      </div>
    </div>
  );
};
