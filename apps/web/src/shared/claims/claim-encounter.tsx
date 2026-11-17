import { usState } from '@ugula/billing';
import { formatDateTime } from '../format.ts';
import { Detail, DetailList } from '../ui/detail-list.tsx';
import { emptyValue } from '../ui/empty-state.tsx';
import { SectionPanel } from '../ui/section-panel.tsx';
import { TextLink } from '../ui/text-link.tsx';
import { addressText } from './claim-data.tsx';
import type { ClaimDetail, EncounterLocation } from './claim-detail.ts';

export const locationText = ({ name, address: a }: EncounterLocation) =>
  addressText({
    name,
    addressLine: a.line,
    city: a.city,
    state: usState(a.state) ?? a.state,
    postalCode: a.postalCode
  });

type EncounterClaim = Pick<
  ClaimDetail,
  'encounter' | 'encounter_number' | 'encounter_revision' | 'import_id' | 'import_file_name'
>;

export const EncounterPanel = ({ claim: c }: { claim: EncounterClaim }) => {
  const { times, pickup, destination, narrative, pcrNumber } = c.encounter;
  return (
    <SectionPanel title="Encounter">
      <DetailList>
        <Detail label="PCR">
          {pcrNumber ?? emptyValue}
          {c.encounter_revision > 1 ? ` (revision ${c.encounter_revision})` : ''}
        </Detail>
        <Detail label="Encounter">{c.encounter_number ?? emptyValue}</Detail>
        <Detail label="At Scene">{formatDateTime(times.atScene)}</Detail>
        <Detail label="Left Scene">{formatDateTime(times.leftScene)}</Detail>
        <Detail label="At Destination">{formatDateTime(times.atDestination)}</Detail>
        <Detail label="Pickup">{locationText(pickup) ?? emptyValue}</Detail>
        <Detail label="Destination">{locationText(destination) ?? emptyValue}</Detail>
        <Detail label="Imported From">
          {c.import_id ? (
            <TextLink to={`/imports/${c.import_id}`}>{c.import_file_name ?? 'Import'}</TextLink>
          ) : (
            emptyValue
          )}
        </Detail>
      </DetailList>
      {narrative ? (
        <p className="text-sm whitespace-pre-line">
          <span className="sr-only">Narrative: </span>
          {narrative}
        </p>
      ) : null}
    </SectionPanel>
  );
};
