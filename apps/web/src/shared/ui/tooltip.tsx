import {
  createContext,
  type ReactNode,
  type RefObject,
  type ToggleEvent,
  use,
  useEffect,
  useId,
  useRef,
  useState
} from 'react';
import { classNamesOf } from '../class-names.ts';
import { hidePopover, showPopover } from './popover.ts';

export type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

type TooltipProps = {
  label: string | undefined;
  isBlock?: boolean;
  side: TooltipSide;
  children: ReactNode;
};

const showDelayMs = 300;
const warmWindowMs = 300;
const touchHideDelayMs = 2500;

const TooltipLastHiddenAtContext = createContext<RefObject<number>>({ current: 0 });

export const TooltipProvider = ({ children }: { children: ReactNode }) => {
  const lastHiddenAtRef = useRef(0);
  return (
    <TooltipLastHiddenAtContext value={lastHiddenAtRef}>{children}</TooltipLastHiddenAtContext>
  );
};

const sideClasses: Readonly<Record<TooltipSide, string>> = {
  top: '[position-area:top]',
  right: '[position-area:right]',
  bottom: '[position-area:bottom]',
  left: '[position-area:left]'
};

export const Tooltip = ({ label, side, isBlock = false, children }: TooltipProps) => {
  const anchorName = `--anchor-${useId().replace(/[^\w-]/g, '')}`;
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);
  const lastHiddenAtRef = use(TooltipLastHiddenAtContext);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (delayMs: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => showPopover(popoverRef.current), delayMs);
    };
    const hide = () => {
      clearTimeout(timer);
      hidePopover(popoverRef.current);
    };
    const showOnPointer = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') {
        show(performance.now() - lastHiddenAtRef.current < warmWindowMs ? 0 : showDelayMs);
      }
    };
    const hideOnPointerLeave = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') {
        hide();
      }
    };
    const toggleOnPointerDown = (event: PointerEvent) => {
      const isTouchToExplain =
        event.pointerType === 'touch' &&
        event.target instanceof Element &&
        trigger.contains(event.target.closest('[aria-disabled="true"]'));
      if (!isTouchToExplain) {
        hide();
        return;
      }
      clearTimeout(timer);
      showPopover(popoverRef.current);
      timer = setTimeout(hide, touchHideDelayMs);
    };
    const showOnFocus = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.matches(':focus-visible')) {
        show(0);
      }
    };
    trigger.addEventListener('pointerenter', showOnPointer);
    trigger.addEventListener('pointerleave', hideOnPointerLeave);
    trigger.addEventListener('pointerdown', toggleOnPointerDown);
    trigger.addEventListener('focusin', showOnFocus);
    trigger.addEventListener('focusout', hide);
    return () => {
      clearTimeout(timer);
      trigger.removeEventListener('pointerenter', showOnPointer);
      trigger.removeEventListener('pointerleave', hideOnPointerLeave);
      trigger.removeEventListener('pointerdown', toggleOnPointerDown);
      trigger.removeEventListener('focusin', showOnFocus);
      trigger.removeEventListener('focusout', hide);
    };
  }, [lastHiddenAtRef]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const hideOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        hidePopover(popoverRef.current);
      }
    };
    const hideOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !triggerRef.current?.contains(event.target)) {
        hidePopover(popoverRef.current);
      }
    };
    document.addEventListener('keydown', hideOnEscape);
    document.addEventListener('pointerdown', hideOnOutsidePointer);
    return () => {
      document.removeEventListener('keydown', hideOnEscape);
      document.removeEventListener('pointerdown', hideOnOutsidePointer);
    };
  }, [isOpen]);

  const onToggle = (event: ToggleEvent) => {
    const isShown = event.newState === 'open';
    setIsOpen(isShown);
    if (!isShown) {
      lastHiddenAtRef.current = performance.now();
    }
  };

  return (
    <span
      ref={triggerRef}
      className={isBlock ? 'flex w-full' : 'inline-flex'}
      style={{ anchorName }}
    >
      {children}
      {label !== undefined && (
        <span
          ref={popoverRef}
          popover="manual"
          aria-hidden="true"
          onToggle={onToggle}
          style={{ positionAnchor: anchorName }}
          className={classNamesOf(
            'pointer-events-none inset-auto m-2 w-max max-w-xs scale-95 rounded-md border-0 bg-surface-fg px-2 py-1 font-semibold text-canvas text-xs opacity-0 shadow-lg transition-[opacity,scale,display,overlay] transition-discrete duration-150 ease-out [position-try-fallbacks:flip-block,flip-inline] open:scale-100 starting:open:scale-95 open:opacity-100 starting:open:opacity-0',
            sideClasses[side]
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
};
