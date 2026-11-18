import {
  AMBULANCE_CONDITIONS,
  type CodeDescriptions,
  ORIGIN_DESTINATION_CODES,
  SEX_LABELS,
  TRANSPORT_REASONS
} from '@ugula/billing';
import { formatDate } from '../format.ts';
import { Detail, DetailList } from '../ui/detail-list.tsx';
import { emptyValue } from '../ui/empty-state.tsx';
import { SectionPanel } from '../ui/section-panel.tsx';
import type { ClaimDetail } from './claim-detail.ts';
import { CodeLabel, CodeText, coded } from './code-text.tsx';

type Place = { name?: string | null } & Record<
  'addressLine' | 'city' | 'state' | 'postalCode',
  string | null
>;

export const addressText = (p: Place | null) =>
  [
    p?.name,
    p?.addressLine,
    [p?.city, [p?.state, p?.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  ]
    .filter(Boolean)
    .join(', ') || null;

const placeOf = (letter: string | undefined) =>
  letter && Object.hasOwn(ORIGIN_DESTINATION_CODES, letter)
    ? (ORIGIN_DESTINATION_CODES[letter] ?? null)
    : null;

const pairOf = (code: string) => {
  const [origin, destination] = [placeOf(code[0]), placeOf(code[1])];
  return code.length === 2 && origin && destination ? `${origin} to ${destination}` : null;
};

export const modifierCode = (code: string) => coded(placeOf(code) ?? pairOf(code), code);

export const claimPlace = (c: ClaimDetail, place: 'pickup' | 'destination') =>
  addressText({
    name: c[`${place}_name`],
    addressLine: c[`${place}_address_line`],
    city: c[`${place}_city`],
    state: c[`${place}_state`],
    postalCode: c[`${place}_postal_code`]
  });

const conditionCode = (code: string) =>
  coded(
    Object.hasOwn(AMBULANCE_CONDITIONS, code)
      ? AMBULANCE_CONDITIONS[code as keyof typeof AMBULANCE_CONDITIONS]
      : null,
    code
  );

export const ClaimDataView = ({
  claim: c,
  codes
}: {
  claim: ClaimDetail;
  codes: CodeDescriptions;
}) => (
  <SectionPanel title="Claim Data">
    <DetailList>
      <Detail label="Date of Service">{formatDate(c.service_date)}</Detail>
      <Detail label="Diagnosis Codes">
        {c.diagnoses.length ? (
          <ol className="flex flex-col gap-1">
            {c.diagnoses.map((d) => (
              <li key={d}>
                <CodeText codes={codes} set="icd10cm" code={d} isInline />
              </li>
            ))}
          </ol>
        ) : (
          emptyValue
        )}
      </Detail>
      <Detail label="Origin Modifier">
        {c.origin_code ? <CodeLabel value={modifierCode(c.origin_code)} /> : emptyValue}
      </Detail>
      <Detail label="Destination Modifier">
        {c.destination_code ? <CodeLabel value={modifierCode(c.destination_code)} /> : emptyValue}
      </Detail>
      <Detail label="Transport Reason">
        {c.transport_reason ? (
          <CodeLabel value={coded(TRANSPORT_REASONS[c.transport_reason], c.transport_reason)} />
        ) : (
          emptyValue
        )}
      </Detail>
      <Detail label="Condition Codes">
        {c.condition_codes.length ? (
          <ul className="flex flex-col gap-1">
            {c.condition_codes.map((code) => (
              <li key={code}>
                <CodeLabel value={conditionCode(code)} />
              </li>
            ))}
          </ul>
        ) : (
          emptyValue
        )}
      </Detail>
      <Detail label="Patient Weight">
        {c.weight_pounds === null ? emptyValue : `${c.weight_pounds} lb`}
      </Detail>
      <Detail label="Pickup Location">{claimPlace(c, 'pickup') ?? emptyValue}</Detail>
      <Detail label="Drop-off Location">{claimPlace(c, 'destination') ?? emptyValue}</Detail>
      <Detail label="Prior Authorization">{c.prior_authorization ?? emptyValue}</Detail>
      <Detail label="Signature on File">{c.is_signature_on_file ? 'Yes' : 'No'}</Detail>
      <Detail label="Claim Note">{c.note ?? emptyValue}</Detail>
      <Detail label="Patient Born">{formatDate(c.birth_date)}</Detail>
      <Detail label="Patient Sex">{c.sex ? SEX_LABELS[c.sex] : emptyValue}</Detail>
      <Detail label="Patient Mailing Address">
        {addressText({
          addressLine: c.address_line,
          city: c.city,
          state: c.state,
          postalCode: c.postal_code
        }) ?? emptyValue}
      </Detail>
    </DetailList>
  </SectionPanel>
);
