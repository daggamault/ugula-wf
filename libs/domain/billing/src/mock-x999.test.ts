import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build999 } from './mock-x999.ts';
import { read999 } from './x999.ts';

const at = { createdAt: new Date('2026-11-03T12:00:00Z'), controlNumber: 7 };

describe('build999', () => {
  it('builds a 999 that accepts or rejects a group', () => {
    assert.deepEqual(
      read999(
        build999(
          { groupControlNumber: '42', transactions: [{ controlNumber: '0001', accepted: true }] },
          at
        )
      ),
      [
        {
          groupControlNumber: '42',
          accepted: true,
          transactions: [{ controlNumber: '0001', accepted: true, errors: [] }]
        }
      ]
    );
    const [rejected] = read999(
      build999(
        {
          groupControlNumber: '43',
          transactions: [
            {
              controlNumber: '0001',
              accepted: false,
              errors: [
                {
                  segment: 'NM1',
                  position: 12,
                  loop: '2010',
                  code: '8',
                  element: { position: '9', code: '7' }
                }
              ]
            }
          ]
        },
        at
      )
    );
    assert.equal(rejected?.accepted, false);
    assert.deepEqual(rejected?.transactions[0]?.errors, [
      'Segment NM1 at position 12 in loop 2010: Segment has data element errors',
      'Element 9: Invalid code value'
    ]);
  });
});
