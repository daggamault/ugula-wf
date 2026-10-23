import { PlayIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { EmptyState, emptyValue } from '../../shared/ui/empty-state.tsx';
import { IconLink } from '../../shared/ui/icon-button.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { GraphSummary, WorkflowsClient } from './client.ts';
import { NewWorkflowDialog } from './new-workflow-dialog.tsx';

export type WorkflowsPageProps = {
  client: WorkflowsClient;
};

export const WorkflowsTable = ({ graphs }: { graphs: readonly GraphSummary[] }) => (
  <Table
    label="Workflows and custom nodes"
    head={[
      'Name',
      { label: 'Key', isSecondary: true },
      'Kind',
      'Published',
      'Draft',
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {graphs.map((g) => (
      <TableRow key={g.id}>
        <TableCell>
          <TextLink to={`/workflows/${g.id}`}>{g.name}</TextLink>
        </TableCell>
        <TableCell isMuted isSecondary>
          <code className="font-mono text-xs">{g.key}</code>
        </TableCell>
        <TableCell>
          <span className="flex gap-1.5">
            <Badge intent={g.kind === 'workflow' ? 'info' : undefined}>
              {g.kind === 'workflow' ? 'Workflow' : 'Node'}
            </Badge>
            {g.isSystem ? <Badge intent="warning">System</Badge> : null}
          </span>
        </TableCell>
        <TableCell isMuted>{g.publishedVersion ? `v${g.publishedVersion}` : emptyValue}</TableCell>
        <TableCell isMuted>{g.draftVersion ? `v${g.draftVersion}` : emptyValue}</TableCell>
        <TableCell kind="actions">
          {g.kind === 'workflow' && g.publishedVersion ? (
            <IconLink
              to={`/runs/new?graph=${g.id}`}
              label={`Run ${g.name}`}
              icon={PlayIcon}
              tooltipSide="left"
            />
          ) : null}
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const WorkflowsPage = ({ client }: WorkflowsPageProps) => {
  const graphs = useResource('graphs', client.list);
  const [creating, setCreating] = useState(false);
  return (
    <Page
      title="Workflows"
      description="Graphs that run as workflows, and custom nodes they are built from."
      actions={
        <Button onClick={() => setCreating(true)}>
          <PlusIcon aria-hidden="true" className="size-4" />
          New Graph
        </Button>
      }
    >
      {graphs.error ? <Alert>{graphs.error.message}</Alert> : null}
      {graphs.data?.length ? (
        <WorkflowsTable graphs={graphs.data} />
      ) : graphs.loading ? (
        <PageLoading />
      ) : (
        <EmptyState title="No Graphs">Create a workflow to get started.</EmptyState>
      )}
      <NewWorkflowDialog client={client} open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
};
