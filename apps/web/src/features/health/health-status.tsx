import { classNamesOf } from '../../shared/class-names.ts';
import type { LiveStatus } from '../../shared/live.ts';
import { Tooltip } from '../../shared/ui/tooltip.tsx';

export type HealthStatusProps = {
  status: LiveStatus;
};

const labels: Record<LiveStatus, string> = {
  connecting: 'Connecting to Live Updates',
  online: 'Live Updates On',
  offline: 'Live Updates Off, Reconnecting'
};

const dots: Record<LiveStatus, string> = {
  connecting: 'bg-warning ring-warning/25 animate-pulse',
  online: 'bg-success ring-success/25',
  offline: 'bg-danger ring-danger/25'
};

export const HealthStatus = ({ status }: HealthStatusProps) => (
  <Tooltip label={labels[status]} side="top">
    <span role="status" className="grid size-6 shrink-0 place-items-center">
      <span
        aria-hidden="true"
        className={classNamesOf('size-2 rounded-full ring-4', dots[status])}
      />
      <span className="sr-only">{labels[status]}</span>
    </span>
  </Tooltip>
);
