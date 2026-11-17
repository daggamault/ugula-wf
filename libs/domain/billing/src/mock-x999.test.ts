import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build999 } from './mock-x999.ts';
import { readX12 } from './x12.ts';
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

  it('marks the group partially accepted, rejected, or as told by its transactions', () => {
    const ak9 = (ack: Parameters<typeof build999>[0]) =>
      readX12(build999(ack, at)).segments.find((s) => s[0] === 'AK9');
    const mixed = [
      { controlNumber: '0001', accepted: true },
      { controlNumber: '0002', accepted: false }
    ];
    assert.deepEqual(ak9({ groupControlNumber: '1', transactions: mixed }), [
      'AK9',
      'P',
      '2',
      '2',
      '1'
    ]);
    assert.deepEqual(ak9({ groupControlNumber: '1', transactions: mixed, accepted: true }), [
      'AK9',
      'A',
      '2',
      '2',
      '1'
    ]);
    assert.deepEqual(ak9({ groupControlNumber: '1', transactions: mixed, accepted: false }), [
      'AK9',
      'R',
      '2',
      '2',
      '0'
    ]);
    assert.deepEqual(
      ak9({ groupControlNumber: '1', transactions: [{ controlNumber: '0001', accepted: false }] }),
      ['AK9', 'R', '1', '1', '0']
    );
  });

  it('acknowledges other transaction sets and errors without a loop or element', () => {
    const segments = readX12(
      build999(
        {
          groupControlNumber: '5',
          functionalId: 'HS',
          transactionSetId: '270',
          version: '005010X279A1',
          transactions: [
            {
              controlNumber: '0001',
              accepted: false,
              errors: [{ segment: 'DMG', position: 9, code: '8' }]
            }
          ]
        },
        at
      )
    ).segments.filter((s) => ['AK1', 'AK2', 'IK3', 'IK4', 'IK5'].includes(s[0] ?? ''));
    assert.deepEqual(segments, [
      ['AK1', 'HS', '5', '005010X279A1'],
      ['AK2', '270', '0001', '005010X279A1'],
      ['IK3', 'DMG', '9', '', '8'],
      ['IK5', 'R']
    ]);
  });
});
