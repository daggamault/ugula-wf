import { branchNode, pin } from '@ugula/graph';
import { type Coverage, coverageKey, readCoverages } from '../claim-details.ts';
import { COVERAGE } from '../models.ts';
import {
  type DirectoryPayer,
  type PayerCandidate,
  type PayerLookup,
  payerDocument,
  payerKey,
  SUGGEST_SIMILARITY,
  suggestPayer
} from '../payers.ts';
import { textOrNull } from '../values.ts';
import type { BillingStores, NodesOf } from './stores.ts';

const CATEGORY = 'Billing';

const coveragesPin = pin('coverages', { list: COVERAGE.type });

const SEARCH_DOWN = 'The payer search was unavailable, so only exact and learned names were linked';

const NOT_SUGGESTED = 'The language model was unavailable, so no payer was suggested';

type Run = { runId: string; signal?: AbortSignal };

const lookupAll = async ({ payers }: BillingStores, run: Run, names: string[]) => {
  try {
    return { lookups: await payers.lookup(run.runId, names, true), notes: [] };
  } catch {
    return { lookups: await payers.lookup(run.runId, names, false), notes: [SEARCH_DOWN] };
  }
};

const suggestionFor = async (
  { payers, completer }: BillingStores,
  run: Run,
  name: string,
  candidates: PayerCandidate[]
) => {
  const key = payerKey(name);
  const cached = await payers.cachedSuggestion(run.runId, key);
  if (cached !== undefined) {
    return { suggested: candidates.find((c) => c.id === cached) ?? null, notes: [] };
  }
  try {
    const suggested = await suggestPayer(completer, name, candidates, run.signal);
    await payers.cacheSuggestion(run.runId, key, suggested?.id ?? null);
    return { suggested, notes: [] };
  } catch {
    return { suggested: null, notes: [NOT_SUGGESTED] };
  }
};

const percent = (similarity: number) => `${Math.round(similarity * 100)}% similar`;

const choices = (
  candidates: PayerCandidate[],
  suggested: PayerCandidate | null,
  directory: DirectoryPayer[]
) => {
  const ordered = suggested
    ? [suggested, ...candidates.filter((p) => p.id !== suggested.id)]
    : candidates;
  const listed = new Set(ordered.map((p) => p.id));
  return [
    ...ordered.map((p) => ({
      value: p.id,
      label: [
        payerDocument(p),
        percent(p.similarity),
        ...(p === suggested ? ['suggested'] : [])
      ].join(' · ')
    })),
    ...directory
      .filter((p) => !listed.has(p.id))
      .map((p) => ({ value: p.id, label: payerDocument(p) }))
  ];
};

const unmatchedFor = async (
  stores: BillingStores,
  run: Run,
  c: Coverage,
  { candidates }: PayerLookup,
  suggest: boolean,
  directory: DirectoryPayer[]
) => {
  const { suggested, notes } = suggest
    ? await suggestionFor(stores, run, c.payer, candidates)
    : { suggested: null, notes: [] };
  return {
    payer: c.payer,
    memberId: c.memberId,
    suggested: suggested && suggested.similarity >= SUGGEST_SIMILARITY ? suggested.id : null,
    candidates: choices(candidates, suggested, directory),
    notes
  };
};

export const payerNodes: NodesOf = (stores) => [
  branchNode({
    type: 'billing.match-payers',
    title: 'Match Payers',
    category: CATEGORY,
    description:
      'Puts coverages in billing priority order, leaves out the ones a biller removed, and links their payers to the payer directory by name or a name billers already matched. Every other name continues through review for a biller, with similar directory payers by embedding first and their similarity; with suggest, the language model picks the likely one, preselected only when it is close. When the search or the model is down, it links what it can and notes it.',
    inputs: [
      coveragesPin,
      pin('suggest', 'boolean', { optional: true }),
      pin('exclude', { list: 'string' }, { optional: true })
    ],
    outputs: [
      coveragesPin,
      pin('unmatched', {
        list: { object: { payer: 'string', candidates: { list: { object: {} } } } }
      }),
      pin('notes', { list: 'string' })
    ],
    exits: ['matched', 'review'],
    compute: async (inputs, _, ctx) => {
      const s = stores();
      const removed = new Set((inputs.exclude ?? []).map((x) => String(x)));
      const coverages = readCoverages(inputs.coverages).filter(
        (c) => !removed.has(coverageKey(c.payer, c.memberId))
      );
      const { lookups, notes } = await lookupAll(
        s,
        ctx,
        coverages.map((c) => c.payer)
      );
      const linked = coverages.map((c, i) => {
        const found = lookups[i] ?? { name: c.payer, known: null, candidates: [] };
        return {
          coverage: {
            ...c,
            payerId: found.known?.id ?? null,
            directoryName: found.known?.name ?? null,
            claimFiling: found.known?.claimFiling ?? null
          },
          found
        };
      });
      const open = linked.filter((l) => !l.found.known);
      const directory = open.length ? await s.payers.directory(ctx.runId) : [];
      const unmatched = [];
      for (const { coverage, found } of open) {
        unmatched.push(
          await unmatchedFor(s, ctx, coverage, found, inputs.suggest !== false, directory)
        );
      }
      return {
        exit: unmatched.length ? 'review' : 'matched',
        outputs: {
          coverages: linked.map((l) => l.coverage),
          unmatched: unmatched.map((u) => ({ ...u, key: coverageKey(u.payer, u.memberId) })),
          notes: [...new Set([...notes, ...unmatched.flatMap((u) => u.notes)])]
        }
      };
    }
  }),
  branchNode({
    type: 'billing.link-payer',
    title: 'Link Payer Alias',
    category: CATEGORY,
    description:
      'Remembers that a payer name from reports means a directory payer, so later reports with that name link automatically. Continues through invalid when no payer or an unknown one was chosen.',
    effect: true,
    inputs: [pin('name', 'string'), pin('payerId', 'string', { optional: true })],
    outputs: [],
    exits: ['linked', 'invalid'],
    compute: async (inputs, _, ctx) => {
      const name = textOrNull(inputs.name);
      const payerId = textOrNull(inputs.payerId);
      const linked =
        name !== null &&
        payerId !== null &&
        (await stores().payers.linkAlias(ctx.runId, name, payerId));
      return { exit: linked ? 'linked' : 'invalid', outputs: {} };
    }
  })
];
