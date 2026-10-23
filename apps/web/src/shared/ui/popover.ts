export const showPopover = (popover: HTMLElement | null) => {
  if (popover && !popover.matches(':popover-open')) {
    popover.showPopover();
  }
};

export const hidePopover = (popover: HTMLElement | null) => {
  if (popover?.matches(':popover-open')) {
    popover.hidePopover();
  }
};
