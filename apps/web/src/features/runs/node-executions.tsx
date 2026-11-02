import { ChevronRightIcon, FolderOpenIcon } from 'lucide-react';
import { formatDateTime, formatDuration } from '../../shared/format.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { IconLink } from '../../shared/ui/icon-button.tsx';
import { JsonView } from '../../shared/ui/json-view.tsx';
import { RunStatusBadge } from '../../shared/ui/run-status-badge.tsx';
import type { RunStep } from './client.ts';
import type { StartedRun } from './inspect.ts';

export type NodeExecutionsProps = {
  title: string;
  steps: readonly RunStep[];
  onOpen?: (() => void) | undefined;
  runs?: readonly StartedRun[];
};

export const NodeExecutions = ({ title, steps, onOpen, runs = [] }: NodeExecutionsProps) => (
  <section aria-labelledby="executions-title" className="flex flex-col gap-4 p-4">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="executions-title" className="text-base font-bold">
          {title}
        </h2>
        <p className="text-surface-fg-muted text-sm">
          {steps.length
            ? `${steps.length} execution${steps.length === 1 ? '' : 's'}`
            : 'Not executed yet'}
        </p>
      </div>
      {onOpen ? (
        <Button variant="outline" onClick={onOpen}>
          <FolderOpenIcon aria-hidden="true" className="size-4" />
          Open building block
        </Button>
      ) : null}
    </header>
    {runs.length ? (
      <div className="flex flex-col gap-2">
        <h3 className="text-surface-fg-muted text-xs font-semibold tracking-wide uppercase">
          Started runs
        </h3>
        <ul className="divide-border border-border flex flex-col divide-y rounded-xl border text-sm">
          {runs.map((r, i) => {
            const name = `#${(r.parent_index ?? i) + 1}${r.name ? ` ${r.name}` : ''}`;
            return (
              <li key={r.id} className="flex items-center gap-2 px-4 py-2">
                <span className="flex-1 font-medium">{name}</span>
                {r.status ? <RunStatusBadge status={r.status} /> : null}
                <IconLink to={`/runs/${r.id}`} label={`Open run ${name}`} icon={ChevronRightIcon} />
              </li>
            );
          })}
        </ul>
      </div>
    ) : null}
    {steps.length ? (
      <ol className="flex flex-col gap-3">
        {[...steps].reverse().map((s) => (
          <li
            key={s.seq}
            className="border-border bg-surface flex flex-col gap-2 rounded-xl border p-4"
          >
            <p className="text-surface-fg-muted flex flex-wrap items-center gap-2 text-xs">
              <span className="text-surface-fg font-semibold">#{s.seq}</span>
              <Badge intent={s.error ? 'danger' : undefined}>{s.event}</Badge>
              {s.pin ? <Badge intent="info">→ {s.pin}</Badge> : null}
              <time dateTime={s.started_at}>{formatDateTime(s.started_at)}</time>
              <span>{formatDuration(s.duration_ms)}</span>
            </p>
            {s.error ? <Alert>{s.error.message}</Alert> : null}
            {Object.keys(s.inputs).length ? <JsonView label="Inputs" value={s.inputs} /> : null}
            {Object.keys(s.outputs).length ? <JsonView label="Outputs" value={s.outputs} /> : null}
          </li>
        ))}
      </ol>
    ) : (
      <EmptyText>This node has not run on this path.</EmptyText>
    )}
  </section>
);
