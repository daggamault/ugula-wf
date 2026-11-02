import { actionNode, branchNode, pin } from '@ugula/graph';
import { type Coverage, readCoverages } from '../claim-details.ts';
import type { Completer } from '../completions.ts';
import { COVERAGE } from '../models.ts';
import { type PayerLookup, payerDocument, suggestPayer } from '../payers.ts';
import { requiredText } from '../values.ts';
import type { NodesOf } from './stores.ts';

const CATEGORY = 'Billing';

const coveragesPin = pin('coverages', { list: COVERAGE.type });

const resolveCoverage = async (
  completer: Completer,
  c: Coverage,
  { known, candidates }: PayerLookup,
  suggest: boolean
) => {
  const coverage = { ...c, payerId: known?.id ?? null, directoryName: known?.name ?? null };
  if (known || !candidates.length) return { coverage, unmatched: null };
  const suggested = suggest ? await suggestPayer(completer, c.payer, candidates) : null;
  const ordered = suggested
    ? [suggested, ...candidates.filter((p) => p.id !== suggested.id)]
    : candidates;
  return {
    coverage,
    unmatched: {
      payer: c.payer,
      memberId: c.memberId,
      suggested: suggested?.id ?? null,
      candidates: ordered.map((p) => ({
        value: p.id,
        label: p === suggested ? `${payerDocument(p)} · suggested` : payerDocument(p)
      }))
    }
  };
};

export const payerNodes: NodesOf = (stores) => [
  branchNode({
    type: 'billing.match-payers',
    title: 'Match Payers',
    category: CATEGORY,
    description:
      'Puts coverages in billing priority order and links their payers to the payer directory by name or a name billers already matched. For other names it finds similar directory payers by embedding and, with suggest, has the language model pick the likely one; those continue through review for a biller to confirm.',
    inputs: [coveragesPin, pin('suggest', 'boolean', { optional: true })],
    outputs: [
      coveragesPin,
      pin('unmatched', {
        list: { object: { payer: 'string', candidates: { list: { object: {} } } } }
      })
    ],
    exits: ['matched', 'review'],
    compute: async (inputs, _, ctx) => {
      const coverages = readCoverages(inputs.coverages);
      const { payers, completer } = stores();
      const lookups = await payers.lookup(
        ctx.runId,
        coverages.map((c) => c.payer)
      );
      const resolved = await Promise.all(
        coverages.map((c, i) =>
          resolveCoverage(
            completer,
            c,
            lookups[i] ?? { name: c.payer, known: null, candidates: [] },
            inputs.suggest !== false
          )
        )
      );
      const unmatched = resolved.flatMap((r) => (r.unmatched ? [r.unmatched] : []));
      return {
        exit: unmatched.length ? 'review' : 'matched',
        outputs: { coverages: resolved.map((r) => r.coverage), unmatched }
      };
    }
  }),
  actionNode({
    type: 'billing.link-payer',
    title: 'Link Payer Alias',
    category: CATEGORY,
    description:
      'Remembers that a payer name from reports means a directory payer, so later reports with that name link automatically.',
    effect: true,
    inputs: [pin('name', 'string'), pin('payerId', 'string')],
    outputs: [],
    compute: async (inputs, _, ctx) => {
      const name = requiredText(inputs.name, 'Choose the directory payer to link');
      const payerId = requiredText(inputs.payerId, 'Choose the directory payer to link');
      await stores().payers.linkAlias(ctx.runId, name, payerId);
      return {};
    }
  })
];
