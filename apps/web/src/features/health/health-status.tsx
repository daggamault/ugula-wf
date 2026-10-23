import { classNamesOf } from '../../shared/class-names.ts';
import { Tooltip } from '../../shared/ui/tooltip.tsx';

export type HealthStatusProps = {
  online?: boolean;
};

const healthLabel = (online: boolean) => (online ? 'Live Updates On' : 'Live Updates Off');

export const HealthStatus = ({ online = true }: HealthStatusProps) => (
  <Tooltip label={healthLabel(online)} side="top">
    <span role="status" className="grid size-6 shrink-0 place-items-center">
      <span
        aria-hidden="true"
        className={classNamesOf(
          'size-2 rounded-full ring-4',
          online ? 'bg-success ring-success/25' : 'bg-danger ring-danger/25'
        )}
      />
      <span className="sr-only">{healthLabel(online)}</span>
    </span>
  </Tooltip>
);
