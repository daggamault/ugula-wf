import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inflateSync } from 'node:zlib';
import { PDFArray, PDFDocument, type PDFRawStream } from 'pdf-lib';
import { localDate, renderStatement, type StatementData } from './statements.ts';

const drawnText = async (bytes: Uint8Array) => {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(0).node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  const stream = refs
    .map((r) =>
      inflateSync((doc.context.lookup(r as never) as PDFRawStream).getContents()).toString('latin1')
    )
    .join('\n');
  return [...stream.matchAll(/<([0-9A-F]*)> Tj/g)].map(([, hex]) =>
    Buffer.from(hex ?? '', 'hex').toString('latin1')
  );
};

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

  it('prints addresses, ZIP+4, a 10-digit phone, every line, payment and the balance due', async () => {
    assert.deepEqual(await drawnText(await renderStatement(statement)), [
      'Development EMS',
      '100 Station Rd',
      'Springfield, IL 62704-1234',
      'Billing questions: (217) 555-0100',
      'PATIENT STATEMENT',
      'Statement: 2 of 5',
      'Date: 2026-11-01',
      'Reference: PCR-1001',
      'Date of service: 2026-10-01',
      'Jose Doe',
      '1 Main St',
      'Springfield, IL 62704',
      'Service',
      'Units',
      'Amount',
      'ALS1, emergency transport (A0427)',
      '1',
      '$950.00',
      'A0425',
      '12.4',
      '$192.20',
      'Total charges',
      '$1,142.20',
      '2026-10-20  Payment from Medicare',
      '-$400.00',
      '2026-10-20  Adjustment by Medicare',
      '-$100.00',
      'Amount due from patient',
      '$642.20',
      'Please call (217) 555-0100 with insurance information or to arrange payment.'
    ]);
  });

  it('leaves out missing address parts, other phone formats, zero amounts and an unknown date', async () => {
    const sparse = await renderStatement({
      ...statement,
      agency: {
        name: 'Development EMS',
        addressLine: null,
        city: 'Springfield',
        state: null,
        postalCode: '627041',
        phone: '217-555-0100'
      },
      patient: { name: 'Jo Doe', addressLine: null, city: null, state: null, postalCode: null },
      serviceDate: null,
      lines: [],
      totalCents: 0,
      payments: [
        { date: '2026-10-20', from: 'Medicare', paidCents: 0, adjustedCents: 500 },
        { date: '2026-10-21', from: 'Patient', paidCents: 500, adjustedCents: 0 }
      ],
      balanceCents: 0
    });
    assert.deepEqual(await drawnText(sparse), [
      'Development EMS',
      'Springfield 627041',
      'Billing questions: 217-555-0100',
      'PATIENT STATEMENT',
      'Statement: 2 of 5',
      'Date: 2026-11-01',
      'Reference: PCR-1001',
      'Date of service: Unknown',
      'Jo Doe',
      'Service',
      'Units',
      'Amount',
      'Total charges',
      '$0.00',
      '2026-10-20  Adjustment by Medicare',
      '-$5.00',
      '2026-10-21  Payment from Patient',
      '-$5.00',
      'Amount due from patient',
      '$0.00',
      'Please call 217-555-0100 with insurance information or to arrange payment.'
    ]);
  });
});
