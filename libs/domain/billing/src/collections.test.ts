import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Placement, placementCsv } from './collections.ts';

const placement: Placement = {
  claimNumber: 'C-2026-0001',
  pcrNumber: 'PCR-1001',
  serviceDate: '2026-10-01',
  patient: 'Doe, Jane "JJ"',
  birthDate: '1950-02-03',
  addressLine: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  postalCode: '62704',
  balanceCents: 64_220,
  placedOn: '2026-11-17',
  agencyName: '=Acme Recovery',
  feePct: 30
};

describe('placementCsv', () => {
  it('writes a header and one quoted, formula-safe row per placement', () => {
    assert.equal(
      placementCsv([placement, { ...placement, pcrNumber: null, birthDate: null }]),
      [
        'Claim,PCR Number,Date of Service,Patient,Birth Date,Street Address,City,State,ZIP Code,Balance,Placed On,Collection Agency,Fee (%)',
        `C-2026-0001,PCR-1001,2026-10-01,"Doe, Jane ""JJ""",1950-02-03,1 Main St,Springfield,IL,62704,$642.20,2026-11-17,'=Acme Recovery,30`,
        `C-2026-0001,,2026-10-01,"Doe, Jane ""JJ""",,1 Main St,Springfield,IL,62704,$642.20,2026-11-17,'=Acme Recovery,30`,
        ''
      ].join('\r\n')
    );
  });

  it('writes only the header when nothing was placed', () => {
    assert.equal(placementCsv([]).split('\r\n').length, 2);
  });
});
