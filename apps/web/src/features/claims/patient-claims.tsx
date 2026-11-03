import { type Live, useLive } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { useTableState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import { CLAIM_TABLE, ClaimsTable } from './claims-page.tsx';
import type { ClaimsClient } from './client.ts';

export const PatientClaims = ({
  client,
  live,
  patientId
}: {
  client: Pick<ClaimsClient, 'list'>;
  live: Live;
  patientId: string;
}) => {
  const table = useTableState(`/patients/${patientId}`, CLAIM_TABLE);
  const list = useResource(`patient-claims:${patientId}:${table.apiQuery}`, () =>
    client.list({ status: 'all', patientId }, table.apiQuery)
  );
  useLive(live, (e) => e.kind === 'claim', list.reload);
  return (
    <SectionPanel title="Claims" description="Every claim for this patient, open or closed.">
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.data?.items.length ? (
        <>
          <ClaimsTable
            claims={list.data.items}
            sorting={table}
            showPatient={false}
            back={table.href}
          />
          <Pagination label="Claims" total={list.data.total} state={table} />
        </>
      ) : list.loading ? (
        <PageLoading />
      ) : (
        <EmptyText>No claims for this patient yet.</EmptyText>
      )}
    </SectionPanel>
  );
};
