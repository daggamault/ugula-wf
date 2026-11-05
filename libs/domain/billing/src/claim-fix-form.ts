import {
  CLAIM_FIX_FIELDS,
  COVERAGE_FIELDS,
  DOCUMENTATION_FIX_FIELDS,
  FIELDS_OF,
  option
} from './claim-fix-fields.ts';
import type { ClaimCheck, ClaimIssue } from './claim-validation.ts';
import type { Address } from './patients.ts';
import { type DirectoryPayer, payerDocument } from './payers.ts';

type FixForm = {
  visible: string[];
  defaults: Record<string, unknown>;
  options: Record<string, { value: string; label: string }[]>;
};

const locationDefaults = (prefix: string, l: Address) => ({
  [`${prefix}AddressLine`]: l.addressLine,
  [`${prefix}City`]: l.city,
  [`${prefix}State`]: l.state,
  [`${prefix}PostalCode`]: l.postalCode
});

export const fixForm = (
  check: ClaimCheck,
  issues: readonly ClaimIssue[],
  directory: readonly DirectoryPayer[],
  all: boolean
): FixForm => {
  const coverageId =
    issues.find((i) => i.coverageId !== null)?.coverageId ?? check.payers[0]?.coverageId ?? null;
  const payer = check.payers.find((p) => p.coverageId === coverageId) ?? null;
  const asked = new Set(
    all
      ? CLAIM_FIX_FIELDS.map((f) => f.name)
      : [...issues.flatMap((i) => FIELDS_OF[i.field]), 'note']
  );
  if (!check.payers.length) for (const f of COVERAGE_FIELDS) asked.delete(f);
  if (!directory.length) asked.delete('payerId');
  const od = check.details.originDestination;
  const doc = check.details.documentation;
  return {
    visible: CLAIM_FIX_FIELDS.map((f) => f.name).filter((n) => asked.has(n)),
    defaults: {
      serviceDate: check.details.serviceDate,
      tripType: check.tripType === 'noClaim' ? null : check.tripType,
      level: check.level,
      emergency: check.emergency,
      loadedMiles: check.loadedMiles,
      deceased: check.deceased,
      nonCoveredMiles: check.nonCoveredMiles,
      diagnoses: check.details.diagnoses,
      ...locationDefaults('pickup', check.details.pickup),
      destinationName: check.details.destination.name,
      ...locationDefaults('destination', check.details.destination),
      originCode: od?.[0] ?? null,
      destinationCode: od?.[1] ?? null,
      transportReason: doc.transportReason,
      signature: doc.signature,
      pcsOnFile: doc.pcsOnFile,
      pcsSignedOn: doc.pcsSignedOn,
      ...Object.fromEntries(
        DOCUMENTATION_FIX_FIELDS.map((f) => [f.name, doc[f.name as keyof typeof doc]])
      ),
      ...(check.patient ? locationDefaults('patient', check.patient) : {}),
      coverageId,
      payerId: payer?.payerId ?? null,
      memberId: payer?.memberId ?? null,
      relationship: payer?.relationship ?? null,
      insuredFirstName: payer?.insuredFirstName ?? null,
      insuredLastName: payer?.insuredLastName ?? null,
      removeCoverage: false
    },
    options: {
      ...(check.payers.length
        ? {
            coverageId: check.payers.flatMap((p) =>
              p.coverageId
                ? [option(p.coverageId, p.memberId ? `${p.name} · ${p.memberId}` : p.name)]
                : []
            )
          }
        : {}),
      ...(directory.length ? { payerId: directory.map((p) => option(p.id, payerDocument(p))) } : {})
    }
  };
};
