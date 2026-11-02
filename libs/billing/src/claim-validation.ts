import { isServiceLevel, type PricedLine, readPricedLines, SERVICE_LEVELS } from './charges.ts';
import {
  type ClaimDetails,
  type Coverage,
  readClaimDetails,
  readCoverages
} from './claim-details.ts';
import { isCents, isRecord, textOrNull } from './values.ts';

export type NewClaim = {
  patientId: string;
  pcrNumber: string | null;
  level: string;
  emergency: boolean;
  loadedMiles: number | null;
  lines: PricedLine[];
  totalCents: number;
  coverages: Coverage[];
  details: ClaimDetails;
  reportKey: string | null;
};

const linesProblem = (lines: unknown) => {
  try {
    readPricedLines(lines);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};

export const claimProblems = (claim: unknown): string[] => {
  const c = isRecord(claim) ? claim : {};
  const lines = linesProblem(c.lines);
  const total =
    !lines && isCents(c.totalCents)
      ? readPricedLines(c.lines).reduce((sum, l) => sum + l.totalCents, 0)
      : null;
  return [
    ...(typeof c.patientId === 'string' && c.patientId ? [] : ['A claim needs a patient']),
    ...(isServiceLevel(c.level)
      ? []
      : [`A claim needs a level of service: ${SERVICE_LEVELS.join(', ')}`]),
    ...(lines ? [lines] : []),
    ...(isCents(c.totalCents) ? [] : ['A claim needs a priced total']),
    ...(total !== null && total !== c.totalCents
      ? ['The claim total does not add up to its lines']
      : []),
    ...(readClaimDetails(c).serviceDate ? [] : ['A claim needs a date of service'])
  ];
};

export const readNewClaim = (claim: unknown): NewClaim => {
  const problems = claimProblems(claim);
  if (problems.length) throw new Error(problems.join('. '));
  const c = claim as Record<string, unknown>;
  const report = isRecord(c.report) ? c.report : {};
  return {
    patientId: c.patientId as string,
    pcrNumber: textOrNull(c.pcrNumber),
    level: c.level as string,
    emergency: c.emergency === true,
    loadedMiles: typeof c.loadedMiles === 'number' ? c.loadedMiles : null,
    lines: readPricedLines(c.lines),
    totalCents: c.totalCents as number,
    coverages: readCoverages(c.coverages),
    details: readClaimDetails(c),
    reportKey: textOrNull(report.key)
  };
};
