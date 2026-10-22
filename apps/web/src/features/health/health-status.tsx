import { Badge } from '../../shared/ui/badge.tsx';

export type HealthStatusProps = {
  online?: boolean;
};

export const HealthStatus = ({ online = true }: HealthStatusProps) => (
  <Badge intent={online ? 'success' : 'danger'}>{online ? 'Online' : 'Offline'}</Badge>
);
