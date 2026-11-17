import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coverageCandidates, discoveryNote } from './discovery.ts';
import type { DiscoveredCoverage } from './x271.ts';

const found = (o: Partial<DiscoveredCoverage>): DiscoveredCoverage => ({
  payerName: 'BLUE PLAN',
  payerCode: 'DEMOBCBS',
  memberId: 'BCX1',
  groupId: 'G1',
  planName: 'PPO',
  entity: 'PR',
  ...o
});

const directory = [
  { id: 'p-blue', name: 'Blue Plan', payerCode: 'DEMOBCBS' },
  { id: 'p-mcd', name: 'Medicaid', payerCode: 'DEMOMCD' }
];

describe('coverageCandidates', () => {
  it('names each coverage found by its directory payer, once per payer and member', () => {
    assert.deepEqual(
      coverageCandidates(
        [
          found({}),
          found({ memberId: 'bcx1 ' }),
          found({ payerCode: 'demomcd', memberId: 'M2', groupId: null, entity: 'SEP' }),
          found({ payerCode: 'UNKNOWN' })
        ],
        directory
      ),
      {
        candidates: [
          {
            payerId: 'p-blue',
            payerName: 'Blue Plan',
            memberId: 'BCX1',
            groupId: 'G1',
            planName: 'PPO',
            entity: 'PR'
          },
          {
            payerId: 'p-mcd',
            payerName: 'Medicaid',
            memberId: 'M2',
            groupId: null,
            planName: 'PPO',
            entity: 'SEP'
          }
        ],
        unmatched: [found({ payerCode: 'UNKNOWN' })]
      }
    );
  });
});

describe('discoveryNote', () => {
  it('says what was found, what the directory lacks and what failed', () => {
    const { candidates } = coverageCandidates([found({})], directory);
    assert.equal(
      discoveryNote(2, candidates, [found({ payerCode: 'X9', payerName: null })], ['Timed out']),
      'Found Blue Plan (member BCX1); X9 (payer ID X9, member BCX1) is not in the payer directory; Timed out'
    );
    assert.equal(discoveryNote(1, [], [], []), 'No coverage found with the 1 payer asked');
    assert.equal(discoveryNote(3, [], [], []), 'No coverage found with the 3 payers asked');
  });
});
