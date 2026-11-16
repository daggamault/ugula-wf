import { branchNode, pin } from '@ugula/graph';
import { type Coverage, coverageKey, readCoverages } from '../claim-details.ts';
import { COVERAGE } from '../party-models.ts';
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

const coveragesPin = pin(
  'coverages',
  { list: COVERAGE.type },
  {
    description: 'The payers of the patient, in billing order.'
  }
);

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
      'Puts coverages in billing priority order, leaves out the ones a biller removed, and links their payers to the payer directory by name or a name billers already matched. Every other name goes to a biller for review, with the most similar directory payers first; when asked, the language model picks the likely one, preselected only when it is close. When the search or the model is down, it links what it can and notes it.',
    level: 'basic',
    keywords: ['insurance', 'payer directory', 'link payer', 'coverage'],
    inputs: [
      coveragesPin,
      pin('suggest', 'boolean', {
        optional: true,
        label: 'Suggest',
        description: 'Let the language model suggest the likely payer for a name.'
      }),
      pin(
        'exclude',
        { list: 'string' },
        {
          optional: true,
          label: 'Removed Payers',
          description: 'The payers a biller removed, left out of billing.'
        }
      )
    ],
    outputs: [
      pin(
        'coverages',
        { list: COVERAGE.type },
        {
          description: 'The payers in billing order, linked to the directory where known.'
        }
      ),
      pin(
        'unmatched',
        {
          list: { object: { payer: 'string', candidates: { list: { object: {} } } } }
        },
        {
          description: 'The payer names a biller has to match, with similar directory payers.'
        }
      ),
      pin(
        'notes',
        { list: 'string' },
        { description: 'What limited the matching, for the biller.' }
      )
    ],
    exits: {
      matched: { label: 'Matched', description: 'Every payer is linked to the directory.' },
      review: { label: 'Review', description: 'Some payer names need a biller to match them.' }
    },
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
      'Remembers that a payer name from reports means a directory payer, so later reports with that name link automatically.',
    level: 'basic',
    keywords: ['alias', 'payer name', 'remember'],
    effect: true,
    inputs: [
      pin('name', 'string', { description: 'The payer name as reports write it.' }),
      pin(
        'payerId',
        { id: 'payer' },
        {
          optional: true,
          label: 'Payer',
          description: 'The directory payer the name means.'
        }
      )
    ],
    outputs: [],
    exits: {
      linked: { label: 'Linked', description: 'The name now links to the payer.' },
      invalid: { label: 'Invalid', description: 'No payer or an unknown one was chosen.' }
    },
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
