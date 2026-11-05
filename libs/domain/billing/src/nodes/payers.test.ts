import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NodeDef, Values } from '@ugula/graph';
import { invokeNode } from '@ugula/graph/testing';
import { billingStores, memoryPayers, scriptedCompleter } from '../testing.ts';
import { payerNodes } from './payers.ts';

const medicare = { id: 'p-medicare', name: 'Medicare', claimFiling: 'MB' };
const blue = { id: 'p-blue', name: 'Blue Cross Blue Shield', claimFiling: 'BL' };

const run = (node: NodeDef | undefined, inputs: Values) => {
  if (!node) throw new Error('No such node');
  return invokeNode(node, { inputs });
};

const similar = {
  BCBS: [
    { ...medicare, similarity: 0.53 },
    { ...blue, similarity: 0.52 }
  ],
  'Blue Cross TX': [{ ...blue, similarity: 0.83 }]
};

const pickBlue = () =>
  scriptedCompleter((r) => ({
    choice: r.user.split('\n').findIndex((l) => l.includes('Blue Cross Blue')) - 1
  }));

const coverages = [
  { payer: 'BCBS', priority: '2611005', memberId: 'B7' },
  { payer: 'Medicare', priority: '2611003' },
  { payer: 'Blue Cross TX', priority: '2611007' },
  { payer: 'Self Pay', priority: '2611009' }
];

describe('payerNodes', () => {
  it('links known names and asks about every other one, preselecting only close suggestions', async () => {
    const payers = memoryPayers({ Medicare: medicare }, similar);
    const model = pickBlue();
    const stores = billingStores({ payers: payers.store, completer: model.completer });
    const [match, link] = payerNodes(() => stores);
    const first = await run(match, { coverages });
    assert.equal(first.pin, 'review');
    assert.deepEqual(
      (
        first.outputs.coverages as {
          payer: string;
          payerId: string | null;
          claimFiling: string | null;
        }[]
      ).map((c) => [c.payer, c.payerId, c.claimFiling]),
      [
        ['Medicare', 'p-medicare', 'MB'],
        ['BCBS', null, null],
        ['Blue Cross TX', null, null],
        ['Self Pay', null, null]
      ]
    );
    const unmatched = first.outputs.unmatched as Record<string, unknown>[];
    assert.deepEqual(
      unmatched.map((u) => [u.payer, u.suggested, u.key]),
      [
        ['BCBS', null, 'bcbs|b7'],
        ['Blue Cross TX', 'p-blue', 'blue cross tx|'],
        ['Self Pay', null, 'self pay|']
      ]
    );
    assert.deepEqual(unmatched[0]?.candidates, [
      {
        value: 'p-blue',
        label: 'Blue Cross Blue Shield (Blue Cross/Blue Shield) · 52% similar · suggested'
      },
      { value: 'p-medicare', label: 'Medicare (Medicare Part B) · 53% similar' }
    ]);
    assert.deepEqual(unmatched[2]?.candidates, [
      { value: 'p-medicare', label: 'Medicare (Medicare Part B)' },
      { value: 'p-blue', label: 'Blue Cross Blue Shield (Blue Cross/Blue Shield)' }
    ]);
    assert.deepEqual(first.outputs.notes, []);
    assert.equal(model.asked.length, 2);
    await run(match, { coverages });
    assert.equal(model.asked.length, 2);

    assert.equal((await run(link, { name: 'BCBS', payerId: 'p-blue' })).pin, 'linked');
    assert.deepEqual([...payers.aliases], [['BCBS', 'p-blue']]);
    assert.equal((await run(link, { name: 'BCBS', payerId: ' ' })).pin, 'invalid');
    assert.equal((await run(link, { name: 'BCBS', payerId: 'p-gone' })).pin, 'invalid');
    const second = await run(match, { coverages, suggest: false, exclude: ['self pay|'] });
    assert.equal((second.outputs.coverages as { payerId: string }[])[1]?.payerId, 'p-blue');
    assert.deepEqual(
      (second.outputs.unmatched as { payer: string }[]).map((u) => u.payer),
      ['Blue Cross TX']
    );
  });

  it('links what it can when the payer search or the model is down, and says so', async () => {
    const payers = memoryPayers({ Medicare: medicare }, similar, { searchDown: true });
    const model = scriptedCompleter(() => {
      throw new Error('model down');
    });
    const stores = billingStores({ payers: payers.store, completer: model.completer });
    const [match] = payerNodes(() => stores);
    const down = await run(match, { coverages });
    assert.equal((down.outputs.coverages as { payerId: string }[])[0]?.payerId, 'p-medicare');
    assert.deepEqual(down.outputs.notes, [
      'The payer search was unavailable, so only exact and learned names were linked'
    ]);
    const unsearched = memoryPayers({}, similar);
    const quiet = billingStores({ payers: unsearched.store, completer: model.completer });
    const [noModel] = payerNodes(() => quiet);
    const result = await run(noModel, { coverages: coverages.slice(0, 1) });
    assert.deepEqual(result.outputs.notes, [
      'The language model was unavailable, so no payer was suggested'
    ]);
    assert.equal(unsearched.suggestions.size, 0);
  });
});
