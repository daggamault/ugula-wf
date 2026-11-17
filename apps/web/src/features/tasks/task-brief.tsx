import { isRecord, type Json } from '@ugula/graph';
import type { ReactNode } from 'react';
import { AlertList } from '../../shared/ui/alert.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import type { TaskDetail } from './client.ts';

const noticesOf = (context: Json, key: 'warnings' | 'notes') =>
  isRecord(context) && Array.isArray(context[key])
    ? context[key].filter((r): r is string => typeof r === 'string' && r !== '')
    : [];

const reasonsOf = (context: Json) =>
  isRecord(context) && Array.isArray(context.reasons)
    ? context.reasons.filter((r): r is string => typeof r === 'string' && r !== '')
    : [];

export const headlineOf = (task: Pick<TaskDetail, 'summary' | 'title'>) =>
  task.summary ?? task.title;

export const TaskIssue = ({
  task,
  children
}: {
  task: Pick<TaskDetail, 'summary' | 'context' | 'title' | 'instructions' | 'kind'>;
  children?: ReactNode;
}) => {
  const reasons = reasonsOf(task.context);
  const warnings = noticesOf(task.context, 'warnings');
  const notes = noticesOf(task.context, 'notes');
  return (
    <SectionPanel
      title={task.kind === 'fault' ? 'What Went Wrong' : 'The Issue'}
      description={headlineOf(task)}
      accent="primary"
    >
      {reasons.length ? (
        <ul className="text-surface-fg-muted flex list-disc flex-col gap-1 pl-5 text-sm">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {warnings.length ? (
        <AlertList intent="warning" title="Warnings" items={warnings.map((text) => ({ text }))} />
      ) : null}
      {notes.length ? (
        <AlertList intent="info" title="Notes" items={notes.map((text) => ({ text }))} />
      ) : null}
      {task.instructions ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">What&apos;s Needed</h3>
          <p className="text-surface-fg-muted text-sm whitespace-pre-line">{task.instructions}</p>
        </div>
      ) : null}
      {children ? <div className="border-border border-t pt-5">{children}</div> : null}
    </SectionPanel>
  );
};
