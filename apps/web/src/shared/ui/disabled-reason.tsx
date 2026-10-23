import type { MouseEvent } from 'react';

export const pendingActionMessage = 'Wait for this to finish.';

export const preventDisabledClick = (event: MouseEvent): void => event.preventDefault();

type DisabledReasonProps = { id: string; reason: string | undefined };

export const DisabledReason = ({ id, reason }: DisabledReasonProps) =>
  reason === undefined ? null : (
    <span id={id} className="sr-only">
      {reason}
    </span>
  );
