import { type Live, useReconnect } from '../../shared/live.ts';
import { Badge } from '../../shared/ui/badge.tsx';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import { FilterSelect } from '../../shared/ui/filter-select.tsx';
import { Highlight } from '../../shared/ui/highlight.tsx';
import { EditLink, RowActions } from '../../shared/ui/icon-button.tsx';
import { Page } from '../../shared/ui/page.tsx';
import { Search } from '../../shared/ui/search.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { type SearchView, useFilterHref, useSearchState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { TableKind, TableSummary, WorkflowsClient } from './client.ts';
import { ScopeBadge, StaleBadge } from './scope-badges.tsx';

export const TABLES_PATH = '/tables';

type TableFilter = 'all' | 'customized';

const TABLE_FILTERS: readonly { value: TableFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'customized', label: 'Customized' }
];

export const tableFilterOf = (query: URLSearchParams): TableFilter =>
  TABLE_FILTERS.find((f) => f.value === query.get('show'))?.value ?? 'all';

export const tableKindLabel = (kind: TableKind) =>
  kind === 'decide' ? 'Decision Table' : 'Lookup Table';

export const TABLES_TABLE = {
  sorts: { name: 'asc', key: 'asc', updated: 'desc' },
  sort: 'name'
} as const;

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
          <span className="flex flex-wrap items-center gap-1">
            <ScopeBadge scope={t.scope} />
            {t.overriddenBy ? <Badge intent="custom">Has Your Copy</Badge> : null}
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

export const TablesPage = ({
  client,
  live,
  show
}: {
  client: WorkflowsClient;
  live: Live;
  show: TableFilter;
}) => {
  const search = useSearchState(TABLES_PATH, TABLES_TABLE);
  const query = `${search.apiQuery}&show=${show}`;
  const tables = useResource(`tables:${query}`, (signal) => client.tables.search(query, signal));
  useReconnect(live, tables.reload);
  const filterHref = useFilterHref(TABLES_PATH);
  return (
    <Page
      title="Tables"
      description="Decision and lookup tables workflows share, which your organization or agency can change without copying a workflow."
    >
      <Search
        label="Tables"
        path={TABLES_PATH}
        search={search}
        results={tables}
        filters={
          <FilterSelect
            id="tables-show"
            label="Show"
            value={show}
            options={TABLE_FILTERS.map((f) => ({
              value: f.value,
              label: f.label,
              href: filterHref('show', f.value === 'all' ? null : f.value)
            }))}
          />
        }
        empty={
          show === 'customized'
            ? {
                title: 'Nothing Customized Yet',
                children: 'Every table is as built. Override one to change its rules.'
              }
            : { title: 'No Tables Yet', children: 'Nothing matches this search.' }
        }
      >
        {(items) => <TablesTable tables={items} search={search} />}
      </Search>
    </Page>
  );
};
