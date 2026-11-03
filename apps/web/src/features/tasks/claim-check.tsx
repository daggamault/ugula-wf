import {
  type ClaimCheck,
  type InsuredRelationship,
  RELATIONSHIP_LABELS,
  TRIP_TYPE_LABELS,
  type TripType
} from '@ugula/billing';
import { isRecord, type Json } from '@ugula/graph';
import { ChargeLines } from '../../shared/claims/charge-lines.tsx';
import { formatCents, formatDate, formatMiles } from '../../shared/format.ts';
import { Detail, DetailList } from '../../shared/ui/detail-list.tsx';
import { EmptyText, emptyValue } from '../../shared/ui/empty-state.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';

type Place = { name?: string | null } & Record<
  'addressLine' | 'city' | 'state' | 'postalCode',
  string | null
>;

export const isClaimCheck = (x: Json | undefined): x is ClaimCheck & Json =>
  isRecord(x) && Array.isArray(x.lines) && Array.isArray(x.payers) && isRecord(x.details);

export const placeText = (p: Place | null) =>
  [p?.name, p?.addressLine, p?.city, [p?.state, p?.postalCode].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ') || emptyValue;

const tripTypeText = (t: string | null) =>
  t && Object.hasOwn(TRIP_TYPE_LABELS, t) ? TRIP_TYPE_LABELS[t as TripType] : (t ?? emptyValue);

const relationshipText = (r: string) =>
  Object.hasOwn(RELATIONSHIP_LABELS, r) ? RELATIONSHIP_LABELS[r as InsuredRelationship] : r;

const insuredText = (p: ClaimCheck['payers'][number]) =>
  [p.insuredFirstName, p.insuredLastName].filter(Boolean).join(' ') || 'The patient';

const subheading = 'text-surface-fg-muted text-xs font-semibold tracking-wide uppercase';

export const ClaimCheckView = ({ claim }: { claim: ClaimCheck }) => (
  <div className="flex flex-col gap-5">
    <DetailList>
      <Detail label="Total" isEmphasized>
        {formatCents(claim.totalCents)}
      </Detail>
      <Detail label="Date of Service">{formatDate(claim.details.serviceDate)}</Detail>
      <Detail label="Trip Type">{tripTypeText(claim.tripType)}</Detail>
      <Detail label="Level of Service">
        {claim.level ?? emptyValue}
        {claim.emergency === null ? '' : claim.emergency ? ', emergency' : ', non-emergency'}
      </Detail>
      <Detail label="Loaded Miles">
        {claim.loadedMiles === null ? emptyValue : formatMiles(claim.loadedMiles)}
      </Detail>
      <Detail label="Diagnoses">{claim.details.diagnoses.join(', ') || emptyValue}</Detail>
      <Detail label="PCR Number">{claim.pcrNumber ?? emptyValue}</Detail>
      <Detail label="Origin/Destination">{claim.details.originDestination ?? emptyValue}</Detail>
      <Detail label="Patient Address">{placeText(claim.patient)}</Detail>
      <Detail label="Pickup">{placeText(claim.details.pickup)}</Detail>
      <Detail label="Destination">{placeText(claim.details.destination)}</Detail>
    </DetailList>
    <section className="flex flex-col gap-3">
      <h3 className={subheading}>Charges</h3>
      {claim.lines.length ? (
        <ChargeLines lines={claim.lines} />
      ) : (
        <EmptyText>No charge lines.</EmptyText>
      )}
    </section>
    <section className="flex flex-col gap-3">
      <h3 className={subheading}>Payers</h3>
      {claim.payers.length ? (
        <Table
          label="Payers on the claim"
          head={['Payer', 'Member ID', "Patient Is the Insured's", 'Insured']}
        >
          {claim.payers.map((p) => (
            <TableRow key={p.coverageId ?? p.name}>
              <TableCell kind="wrap">{p.name}</TableCell>
              <TableCell>{p.memberId ?? emptyValue}</TableCell>
              <TableCell>{relationshipText(p.relationship)}</TableCell>
              <TableCell>{insuredText(p)}</TableCell>
            </TableRow>
          ))}
        </Table>
      ) : (
        <EmptyText>No payers, so the patient is billed.</EmptyText>
      )}
    </section>
  </div>
);
