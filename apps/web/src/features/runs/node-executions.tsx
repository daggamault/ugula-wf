import { FolderOpenIcon } from 'lucide-react';
import { formatDateTime, formatDuration } from '../../shared/format.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { OpenLink } from '../../shared/ui/icon-button.tsx';
import { JsonView } from '../../shared/ui/json-view.tsx';
import { RunStatusBadge } from '../../shared/ui/run-status-badge.tsx';
import { Section } from '../../shared/ui/section-panel.tsx';
import type { RunStep } from './client.ts';
import type { StartedRun } from './inspect.ts';

type NodeExecutionsProps = {
  title: string;
  steps: readonly RunStep[];
  onOpen?: (() => void) | undefined;
  runs?: readonly StartedRun[];
};

const executionsOf = (count: number) =>
  count
    ? `It ran ${count} ${count === 1 ? 'time' : 'times'} on this path, newest first.`
    : 'It has not run on this path yet.';

export const NodeExecutions = ({ title, steps, onOpen, runs = [] }: NodeExecutionsProps) => (
  <div className="flex flex-col gap-6 p-4">
    <Section
      title={title}
      description={executionsOf(steps.length)}
      actions={
        onOpen ? (
          <Button variant="outline" onClick={onOpen}>
            <FolderOpenIcon aria-hidden="true" className="size-4" />
            Open Building Block
          </Button>
        ) : null
      }
    >
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
              {Object.keys(s.outputs).length ? (
                <JsonView label="Outputs" value={s.outputs} />
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <EmptyText>This node has not run on this path.</EmptyText>
      )}
    </Section>
    {runs.length ? (
      <Section title="Started Runs" description="The runs this node launched.">
        <ul className="divide-border border-border flex flex-col divide-y rounded-xl border text-sm">
          {runs.map((r, i) => {
            const name = `#${(r.parent_index ?? i) + 1}${r.name ? ` ${r.name}` : ''}`;
            return (
              <li key={r.id} className="flex items-center gap-2 px-4 py-3">
                <span className="flex-1 font-medium">{name}</span>
                {r.status ? <RunStatusBadge status={r.status} /> : null}
                <OpenLink to={`/runs/${r.id}`} name={`run ${name}`} />
              </li>
            );
          })}
        </ul>
      </Section>
    ) : null}
  </div>
);
