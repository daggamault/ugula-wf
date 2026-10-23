import { FolderOpenIcon } from 'lucide-react';
import { formatDateTime, formatDuration } from '../../shared/format.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { JsonView } from '../../shared/ui/json-view.tsx';
import type { RunStep } from './client.ts';

export type NodeExecutionsProps = {
  title: string;
  steps: readonly RunStep[];
  onOpen?: (() => void) | undefined;
};

export const NodeExecutions = ({ title, steps, onOpen }: NodeExecutionsProps) => (
  <section aria-labelledby="executions-title" className="flex flex-col gap-4 p-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="executions-title" className="text-lg font-bold tracking-tight">
          {title}
        </h2>
        <p className="text-surface-fg-muted text-sm">
          {steps.length
            ? `${steps.length} execution${steps.length === 1 ? '' : 's'}`
            : 'Not executed yet'}
        </p>
      </div>
      {onOpen ? (
        <Button variant="outline" size="sm" onClick={onOpen}>
          <FolderOpenIcon aria-hidden="true" className="size-4" />
          Open sub-graph
        </Button>
      ) : null}
    </header>
    {steps.length ? (
      <ol className="flex flex-col gap-3">
        {[...steps].reverse().map((s) => (
          <li
            key={s.seq}
            className="border-border bg-canvas/50 flex flex-col gap-2 rounded-xl border p-3"
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
