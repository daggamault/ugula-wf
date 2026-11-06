import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { localDate, money, renderStatement, type StatementData } from './statements.ts';

const statement: StatementData = {
  number: 2,
  count: 5,
  issuedOn: '2026-11-01',
  agency: {
    name: 'Development EMS',
    addressLine: '100 Station Rd',
    city: 'Springfield',
    state: 'IL',
    postalCode: '627041234',
    phone: '2175550100'
  },
  patient: {
    name: 'José Doe',
    addressLine: '1 Main St',
    city: 'Springfield',
    state: 'IL',
    postalCode: '62704'
  },
  reference: 'PCR-1001',
  serviceDate: '2026-10-01',
  lines: [
    {
      code: 'A0427',
      units: 1,
      unitCents: 95_000,
      totalCents: 95_000,
      description: 'ALS1, emergency transport'
    },
    { code: 'A0425', units: 12.4, unitCents: 1_550, totalCents: 19_220, description: null }
  ],
  totalCents: 114_220,
  payments: [{ date: '2026-10-20', from: 'Medicare', paidCents: 40_000, adjustedCents: 10_000 }],
  balanceCents: 64_220
};

describe('statements', () => {
  it('formats money', () => {
    assert.equal(money(114_220), '$1,142.20');
    assert.equal(money(-500), '-$5.00');
    assert.equal(money(5), '$0.05');
    assert.equal(money(0), '$0.00');
  });

  it('dates a statement in the agency time zone', () => {
    const lateEvening = new Date('2026-11-02T03:30:00Z');
    assert.equal(localDate(lateEvening, 'America/Chicago'), '2026-11-01');
    assert.equal(localDate(lateEvening, 'UTC'), '2026-11-02');
  });

  it('strips characters the standard PDF fonts cannot draw', async () => {
    const bytes = await renderStatement({
      ...statement,
      patient: { ...statement.patient, name: 'José · Ñoño ✓' }
    });
    assert.equal((await PDFDocument.load(bytes)).getTitle(), 'Statement 2 of 5 - Jose  Nono ');
  });

  it('renders a one-page PDF statement deterministically', async () => {
    const bytes = await renderStatement(statement);
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 1);
    assert.equal(doc.getTitle(), 'Statement 2 of 5 - Jose Doe');
    assert.deepEqual(await renderStatement(statement), bytes);
  });
});
