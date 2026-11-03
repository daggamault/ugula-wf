import { CLAIM_FIELDS, CLAIM_ISSUE_LEVELS, type ClaimField, type ClaimIssue } from '@ugula/billing';
import { isRecord, type Json } from '@ugula/graph';
import { AlertList } from '../ui/alert.tsx';

const CLAIM_FIELD_LABELS: Readonly<Record<ClaimField, string>> = {
  patient: 'Patient',
  patientAddress: 'Patient Address',
  pcrNumber: 'PCR Number',
  serviceDate: 'Date of Service',
  tripType: 'Trip Type',
  level: 'Level of Service',
  emergency: 'Emergency',
  loadedMiles: 'Loaded Miles',
  lines: 'Charges',
  diagnoses: 'Diagnoses',
  pickup: 'Pickup',
  destination: 'Destination',
  originDestination: 'Origin/Destination',
  payers: 'Payers',
  payer: 'Payer',
  memberId: 'Member ID',
  insured: 'Insured'
};

const isIssue = (x: Json): x is ClaimIssue =>
  isRecord(x) &&
  CLAIM_ISSUE_LEVELS.some((l) => l === x.level) &&
  CLAIM_FIELDS.some((f) => f === x.field) &&
  typeof x.message === 'string';

export const isIssueList = (x: Json | undefined): x is ClaimIssue[] =>
  Array.isArray(x) && x.every(isIssue);

const itemsOf = (issues: readonly ClaimIssue[]) =>
  issues.map((i) => ({ label: CLAIM_FIELD_LABELS[i.field], text: i.message }));

export const ClaimIssues = ({ issues }: { issues: readonly ClaimIssue[] }) => {
  const blocking = issues.filter((i) => i.level === 'blocking');
  const warnings = issues.filter((i) => i.level === 'warning');
  return (
    <>
      {blocking.length ? (
        <AlertList intent="danger" title="Must Be Fixed" items={itemsOf(blocking)} />
      ) : null}
      {warnings.length ? (
        <AlertList intent="warning" title="Worth Checking" items={itemsOf(warnings)} />
      ) : null}
    </>
  );
};
