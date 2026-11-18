import { type CodeDescriptions, ORIGIN_DESTINATION_CODES } from '@ugula/billing';
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
      <Detail label="Patient Born">{formatDate(c.birth_date)}</Detail>
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
