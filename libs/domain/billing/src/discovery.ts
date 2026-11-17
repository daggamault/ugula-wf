import type { DiscoveredCoverage } from './x271.ts';

export type CoverageCandidate = {
  payerId: string;
  payerName: string;
  memberId: string;
  groupId: string | null;
  planName: string | null;
  entity: string;
};

type DirectoryPayer = { id: string; name: string; payerCode: string };

const keyOf = (x: string) => x.trim().toLowerCase();

export const coverageCandidates = (found: DiscoveredCoverage[], directory: DirectoryPayer[]) => {
  const byCode = new Map(directory.map((p) => [keyOf(p.payerCode), p]));
  const seen = new Set<string>();
  const candidates = found.flatMap((c): CoverageCandidate[] => {
    const payer = byCode.get(keyOf(c.payerCode));
    const key = `${payer?.id}:${keyOf(c.memberId)}`;
    if (!payer || seen.has(key)) return [];
    seen.add(key);
    return [
      {
        payerId: payer.id,
        payerName: payer.name,
        memberId: c.memberId,
        groupId: c.groupId,
        planName: c.planName,
        entity: c.entity
      }
    ];
  });
  return { candidates, unmatched: found.filter((c) => !byCode.has(keyOf(c.payerCode))) };
};

export const discoveryNote = (
  asked: number,
  candidates: CoverageCandidate[],
  unmatched: DiscoveredCoverage[],
  errors: string[]
) =>
  [
    candidates.length
      ? `Found ${candidates.map((c) => `${c.payerName} (member ${c.memberId})`).join(', ')}`
      : `No coverage found with the ${asked} payer${asked === 1 ? '' : 's'} asked`,
    ...unmatched.map(
      (c) =>
        `${c.payerName ?? c.payerCode} (payer ID ${c.payerCode}, member ${c.memberId}) is not in the payer directory`
    ),
    ...errors
  ].join('; ');
