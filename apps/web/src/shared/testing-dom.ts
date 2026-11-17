import { afterEach } from 'node:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost:3000/' });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const openPopovers = new WeakSet<Element>();
const togglePopoverTo = (el: HTMLElement, open: boolean) => {
  if (openPopovers.has(el) === open) return;
  if (open) openPopovers.add(el);
  else openPopovers.delete(el);
  const event = Object.assign(new Event('toggle'), {
    newState: open ? 'open' : 'closed',
    oldState: open ? 'closed' : 'open'
  });
  el.dispatchEvent(event);
};
const matches = Element.prototype.matches;
const inDisabledFieldset = (el: Element) => {
  for (let f = el.parentElement?.closest('fieldset[disabled]'); f; ) {
    const legend = f.querySelector(':scope > legend');
    if (!legend?.contains(el)) return true;
    f = f.parentElement?.closest('fieldset[disabled]');
  }
  return false;
};
const formControls = 'button, input, select, textarea, fieldset';
Object.assign(Element.prototype, {
  matches(this: Element, selector: string) {
    if (selector === ':popover-open') return openPopovers.has(this);
    if (selector === ':disabled') {
      return (
        matches.call(this, selector) ||
        (matches.call(this, formControls) && inDisabledFieldset(this))
      );
    }
    return matches.call(this, selector);
  }
});
Object.assign(HTMLElement.prototype, {
  showPopover(this: HTMLElement) {
    togglePopoverTo(this, true);
  },
  hidePopover(this: HTMLElement) {
    togglePopoverTo(this, false);
  },
  togglePopover(this: HTMLElement, force?: boolean) {
    const open = force ?? !openPopovers.has(this);
    togglePopoverTo(this, open);
    return open;
  }
});

const validityProto = Object.getPrototypeOf(document.createElement('input').validity);
const happyStepMismatch = Object.getOwnPropertyDescriptor(validityProto, 'stepMismatch')?.get;
Object.defineProperty(validityProto, 'stepMismatch', {
  get(this: { element: HTMLInputElement }) {
    const step = Number(this.element.getAttribute('step'));
    if (this.element.type !== 'number' || !step) return happyStepMismatch?.call(this);
    const steps = Number(this.element.value) / step;
    return Math.abs(steps - Math.round(steps)) > 1e-9;
  }
});

const { cleanup, render, screen, waitFor, within, act } = await import('@testing-library/react');
const { userEvent } = await import('@testing-library/user-event');

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

export { act, render, screen, userEvent, waitFor, within };
