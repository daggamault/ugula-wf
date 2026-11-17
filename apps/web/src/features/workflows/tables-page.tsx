import { type Live, useReconnect } from '../../shared/live.ts';
import { Badge } from '../../shared/ui/badge.tsx';
import type { ColumnFilter } from '../../shared/ui/column-filters.tsx';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import { Highlight } from '../../shared/ui/highlight.tsx';
import { EditLink, RowActions } from '../../shared/ui/icon-button.tsx';
import { Page } from '../../shared/ui/page.tsx';
import { Search } from '../../shared/ui/search.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { type SearchView, useSearchState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { TableKind, TableSummary, WorkflowsClient } from './client.ts';
import { SCOPE_FILTER, ScopeBadge, StaleBadge } from './scope-badges.tsx';

export const TABLES_PATH = '/tables';

export const tableKindLabel = (kind: TableKind) =>
  kind === 'decide' ? 'Decision Table' : 'Lookup Table';

export const TABLES_TABLE = {
  sorts: { name: 'asc', key: 'asc', updated: 'desc' },
  sort: 'name',
  filters: ['kind', 'scope']
} as const;

const TABLE_KIND_FILTER: ColumnFilter = {
  key: 'kind',
  label: 'Kind',
  labelOf: (o) => tableKindLabel(o.value === 'decide' ? 'decide' : 'lookup')
};

export const TablesTable = ({
  tables,
  search
}: {
  tables: readonly TableSummary[];
  search: SearchView;
}) => (
  <Table
    label="Tables"
    sorting={search}
    head={[
      { label: 'Name', sort: 'name' },
      { label: 'Key', isSecondary: true, sort: 'key' },
      'Kind',
      'Scope',
      'Published',
      'Draft',
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {tables.map((t) => (
      <TableRow key={t.id}>
        <TableCell>
          <span className="font-medium">
            <Highlight text={t.name} query={search.q} />
          </span>
        </TableCell>
        <TableCell isMuted isSecondary>
          <code className="font-mono text-xs">
            <Highlight text={t.key} query={search.q} />
          </code>
        </TableCell>
        <TableCell>
          <Badge>{tableKindLabel(t.kind)}</Badge>
        </TableCell>
        <TableCell>
          <span className="flex flex-wrap items-center gap-2">
            <ScopeBadge scope={t.scope} />
            {t.overriddenBy ? <Badge intent="custom">Has Custom Copy</Badge> : null}
            <StaleBadge stale={t.isStale} />
          </span>
        </TableCell>
        <TableCell isMuted>{t.publishedVersion ? `v${t.publishedVersion}` : emptyValue}</TableCell>
        <TableCell isMuted>{t.draftVersion ? `v${t.draftVersion}` : emptyValue}</TableCell>
        <TableCell kind="actions">
          <RowActions>
            <EditLink to={`${TABLES_PATH}/${t.id}`} name={t.name} />
          </RowActions>
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const TablesPage = ({ client, live }: { client: WorkflowsClient; live: Live }) => {
  const search = useSearchState(TABLES_PATH, TABLES_TABLE);
  const tables = useResource(`tables:${search.apiQuery}`, (signal) =>
    client.tables.search(search.apiQuery, signal)
  );
  useReconnect(live, tables.reload);
  return (
    <Page title="Tables" description="Your agency can change them without copying a workflow.">
      <Search
        label="Tables"
        path={TABLES_PATH}
        search={search}
        results={tables}
        filters={[TABLE_KIND_FILTER, SCOPE_FILTER]}
        empty={{ title: 'No Tables Yet' }}
      >
        {(items) => <TablesTable tables={items} search={search} />}
      </Search>
    </Page>
  );
};
