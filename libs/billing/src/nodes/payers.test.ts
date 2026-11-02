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

describe('payerNodes', () => {
  it('links known payer names, suggests the likely payer for the rest and learns aliases', async () => {
    const payers = memoryPayers(
      { Medicare: medicare },
      {
        BCBS: [
          { ...medicare, similarity: 0.53 },
          { ...blue, similarity: 0.52 }
        ],
        'Blue Cross TX': [{ ...blue, similarity: 0.73 }]
      }
    );
    const model = scriptedCompleter((r) => ({
      choice: r.user.split('\n').findIndex((l) => l.includes('Blue Cross Blue')) - 1
    }));
    const stores = billingStores({ payers: payers.store, completer: model.completer });
    const [match, link] = payerNodes(() => stores);
    const coverages = [
      { payer: 'BCBS', priority: '2611005', memberId: 'B7' },
      { payer: 'Medicare', priority: '2611003' },
      { payer: 'Blue Cross TX', priority: '2611007' },
      { payer: 'Self Pay', priority: '2611009' }
    ];
    const first = await run(match, { coverages });
    assert.equal(first.pin, 'review');
    assert.deepEqual(
      (first.outputs.coverages as { payer: string; payerId: string | null }[]).map((c) => [
        c.payer,
        c.payerId
      ]),
      [
        ['Medicare', 'p-medicare'],
        ['BCBS', null],
        ['Blue Cross TX', null],
        ['Self Pay', null]
      ]
    );
    const suggested = 'Blue Cross Blue Shield (Blue Cross/Blue Shield) · suggested';
    assert.deepEqual(first.outputs.unmatched, [
      {
        payer: 'BCBS',
        memberId: 'B7',
        suggested: 'p-blue',
        candidates: [
          { value: 'p-blue', label: suggested },
          { value: 'p-medicare', label: 'Medicare (Medicare Part B)' }
        ]
      },
      {
        payer: 'Blue Cross TX',
        memberId: null,
        suggested: 'p-blue',
        candidates: [{ value: 'p-blue', label: suggested }]
      }
    ]);
    assert.equal(model.asked.length, 2);
    await run(link, { name: 'BCBS', payerId: 'p-blue' });
    assert.deepEqual([...payers.aliases], [['BCBS', 'p-blue']]);
    await assert.rejects(
      async () => run(link, { name: 'BCBS', payerId: ' ' }),
      /Choose the directory/
    );
    const second = await run(match, { coverages, suggest: false });
    assert.equal(second.pin, 'review');
    assert.equal((second.outputs.coverages as { payerId: string }[])[1]?.payerId, 'p-blue');
    assert.deepEqual(second.outputs.unmatched, [
      {
        payer: 'Blue Cross TX',
        memberId: null,
        suggested: null,
        candidates: [{ value: 'p-blue', label: 'Blue Cross Blue Shield (Blue Cross/Blue Shield)' }]
      }
    ]);
    assert.equal(model.asked.length, 2);
  });
});
