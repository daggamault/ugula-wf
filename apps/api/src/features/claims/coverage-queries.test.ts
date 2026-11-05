import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { reorderCoverages } from './coverage-queries.ts';

describe('coverage queries', () => {
  it('removes, repositions and adds coverages, then touches the claim', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await reorderCoverages(db, 't-1', 'c1', {
      keep: [{ id: 'k1', position: 2 }],
      add: [
        {
          payer: 'Aetna Inc.',
          position: 1,
          relationship: '01',
          insuredFirstName: 'Sam',
          insuredLastName: 'Doe'
        }
      ],
      remove: ['r1']
    });
    const insert = queries.find((q) => q.sql.startsWith('insert into "claim_coverages"'));
    assert.match(
      insert?.sql ?? '',
      /\(lower\(name\) = \$\d+ or "id" in \(select "payer_id" from "payer_aliases" where "agency_id" = \$\d+ and "alias_key" = \$\d+\)\)/
    );
    assert.ok(insert?.parameters.includes('aetna inc'));
    assert.ok(insert?.sql.includes('"agency_id", "position", "payer_name", "relationship"'));
    assert.deepEqual(insert?.parameters.slice(0, 7), [
      'c1',
      't-1',
      1,
      'Aetna Inc.',
      '01',
      'Sam',
      'Doe'
    ]);
    assert.deepEqual(
      queries.map((q) => q.sql.trim().split(/\s+/).slice(0, 3).join(' ')),
      [
        'delete from "claim_coverages"',
        'update claim_coverages cc',
        'insert into "claim_coverages"',
        'update "claims" set'
      ]
    );
  });
});
