import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LineAdjudication } from './claims.ts';
import { claimLevelAdjustments, matchServiceLines } from './line-adjudications.ts';
import type { RemittanceService } from './x835.ts';

const service = (over: Partial<RemittanceService>): RemittanceService => ({
  code: 'A0427',
  modifiers: ['RH'],
  chargeCents: 85_000,
  paidCents: 50_000,
  units: 1,
  originalCode: null,
  lineNumber: null,
  adjustments: [{ group: 'CO', reason: '45', cents: 35_000 }],
  ...over
});

const BILLED = [
  { position: 1, code: 'A0427', chargeCents: 85_000 },
  { position: 2, code: 'A0425', chargeCents: 9250 },
  { position: 3, code: 'A0425', chargeCents: 1000 }
];

describe('matchServiceLines', () => {
  it('matches by the line control number the 837P sent, then by code and charge', () => {
    const matched = matchServiceLines(
      [
        service({ code: 'A0425', chargeCents: 1000, paidCents: 0, lineNumber: '3' }),
        service({ code: 'A0425', chargeCents: 9250, paidCents: 6000 }),
        service({})
      ],
      BILLED
    );
    assert.deepEqual(
      matched.map((m) => [m.line, m.paidCents]),
      [
        [3, 0],
        [2, 6000],
        [1, 50_000]
      ]
    );
  });

  it('states each matched line as the payer adjudicated it', () => {
    assert.deepEqual(
      matchServiceLines([service({ modifiers: ['RH', 'GY'], units: 2, lineNumber: '1' })], BILLED),
      [
        {
          line: 1,
          code: 'A0427',
          modifiers: ['RH', 'GY'],
          paidCents: 50_000,
          units: 2,
          adjustments: [{ group: 'CO', reason: '45', cents: 35_000 }]
        }
      ]
    );
    assert.deepEqual(matchServiceLines([], BILLED), []);
    assert.deepEqual(matchServiceLines([service({})], []), []);
  });

  it('falls back to the code when the line number is not a whole number or already matched', () => {
    const matched = matchServiceLines(
      [
        service({ code: 'A0425', chargeCents: 1000, lineNumber: '3' }),
        service({ code: 'A0425', chargeCents: 1000, lineNumber: '3' }),
        service({ lineNumber: '1.5' })
      ],
      BILLED
    );
    assert.deepEqual(
      matched.map((m) => m.line),
      [3, 2, 1]
    );
  });

  it('takes the first open line of the code when no charge matches, and each line once', () => {
    const matched = matchServiceLines(
      [
        service({ code: 'A0425', chargeCents: 5 }),
        service({ code: 'A0425', chargeCents: 5 }),
        service({ code: 'A0425', chargeCents: 5 })
      ],
      BILLED
    );
    assert.deepEqual(
      matched.map((m) => m.line),
      [2, 3]
    );
  });

  it('skips a service whose code is not HCPCS, leaving its line open', () => {
    const matched = matchServiceLines(
      [service({ code: 'NU', lineNumber: '1' }), service({ lineNumber: '1' })],
      BILLED
    );
    assert.deepEqual(
      matched.map((m) => [m.line, m.code]),
      [[1, 'A0427']]
    );
  });

  it('matches a recoded line by its original code and skips a service no line has', () => {
    const matched = matchServiceLines(
      [
        service({ code: 'A0428', originalCode: 'A0427', lineNumber: '9' }),
        service({ code: 'A0999' })
      ],
      BILLED
    );
    assert.deepEqual(
      matched.map((m) => [m.line, m.code]),
      [[1, 'A0428']]
    );
  });

  it('drops zero adjustments and matches a reversal by code despite its negative charge', () => {
    const [m] = matchServiceLines(
      [
        service({
          chargeCents: -85_000,
          adjustments: [
            { group: 'CO', reason: '253', cents: 0 },
            { group: 'CO', reason: '45', cents: -35_000 }
          ]
        })
      ],
      BILLED
    );
    assert.deepEqual(
      [m?.line, m?.adjustments],
      [1, [{ group: 'CO', reason: '45', cents: -35_000 }]]
    );
  });
});

const adjudication = (line: number, paidCents: number, cents: number): LineAdjudication => ({
  line,
  code: 'A0427',
  modifiers: [],
  paidCents,
  units: 1,
  adjustments: [{ group: 'CO', reason: '45', cents }]
});

describe('claimLevelAdjustments', () => {
  it('keeps the adjustments no line carries', () => {
    assert.deepEqual(
      claimLevelAdjustments(
        [
          { group: 'CO', reason: '45', cents: 400 },
          { group: 'OA', reason: '23', cents: 100 }
        ],
        [adjudication(1, 600, 400)]
      ),
      [{ group: 'OA', reason: '23', cents: 100 }]
    );
  });

  it('nets out what the lines carry, keeping a remainder at claim level', () => {
    assert.deepEqual(
      claimLevelAdjustments(
        [{ group: 'CO', reason: '45', cents: 500 }],
        [adjudication(1, 600, 300), adjudication(2, 0, 50)]
      ),
      [{ group: 'CO', reason: '45', cents: 150 }]
    );
    assert.deepEqual(claimLevelAdjustments([], [adjudication(1, 600, 300)]), [
      { group: 'CO', reason: '45', cents: -300 }
    ]);
    assert.deepEqual(claimLevelAdjustments([], []), []);
  });
});
