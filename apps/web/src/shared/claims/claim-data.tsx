import { type CodeDescriptions, ORIGIN_DESTINATION_CODES } from '@ugula/billing';
import { formatDate } from '../format.ts';
import { Detail, DetailList } from '../ui/detail-list.tsx';
import { emptyValue } from '../ui/empty-state.tsx';
import { SectionPanel } from '../ui/section-panel.tsx';
import type { ClaimDetail } from './claim-detail.ts';
import { CodeText } from './code-text.tsx';

type Place = {
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

export const addressText = (p: Place) =>
  [
    p.addressLine,
    [p.city, [p.state, p.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  ]
    .filter(Boolean)
    .join(', ') || null;

export const modifierText = (code: string | null) =>
  code && Object.hasOwn(ORIGIN_DESTINATION_CODES, code)
    ? `${ORIGIN_DESTINATION_CODES[code as keyof typeof ORIGIN_DESTINATION_CODES]} (${code})`
    : code;

export const ClaimDataView = ({
  claim: c,
  codes
}: {
  claim: ClaimDetail;
  codes: CodeDescriptions;
}) => (
  <SectionPanel
    title="Claim Data"
    description="What goes on the 837P besides the payers and documentation. Change it with the Correct Claim Data task."
  >
    <DetailList>
      <Detail label="Date of Service">{formatDate(c.service_date)}</Detail>
      <Detail label="Diagnosis Codes">
        {c.diagnoses.length ? (
          <ol className="flex flex-col gap-1">
            {c.diagnoses.map((d) => (
              <li key={d}>
                <CodeText codes={codes} set="icd10cm" code={d} />
              </li>
            ))}
          </ol>
        ) : (
          emptyValue
        )}
      </Detail>
      <Detail label="Pickup Type">{modifierText(c.origin_code) ?? emptyValue}</Detail>
      <Detail label="Destination Type">{modifierText(c.destination_code) ?? emptyValue}</Detail>
      <Detail label="Patient Mailing Address">
        {addressText({
          addressLine: c.address_line,
          city: c.city,
          state: c.state,
          postalCode: c.postal_code
        }) ?? emptyValue}
      </Detail>
      <Detail label="Pickup">
        {addressText({
          addressLine: c.pickup_address_line,
          city: c.pickup_city,
          state: c.pickup_state,
          postalCode: c.pickup_postal_code
        }) ?? emptyValue}
      </Detail>
      <Detail label="Destination">
        {[
          c.destination_name,
          addressText({
            addressLine: c.destination_address_line,
            city: c.destination_city,
            state: c.destination_state,
            postalCode: c.destination_postal_code
          })
        ]
          .filter(Boolean)
          .join(', ') || emptyValue}
      </Detail>
    </DetailList>
  </SectionPanel>
);
