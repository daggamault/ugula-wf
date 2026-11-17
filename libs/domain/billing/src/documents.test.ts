import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import {
  appendPdfs,
  fieldSections,
  invoiceTotal,
  letterhead,
  renderAppealPacket,
  renderDocument,
  renderFacilityInvoice,
  wrap
} from './documents.ts';

const agency = {
  name: 'Metro EMS',
  addressLine: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  postalCode: '62701',
  phone: '2175550100'
};

const pagesOf = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount();

const titleOf = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes, { updateMetadata: false })).getTitle();

describe('documents', () => {
  it('wraps long text into printable lines', () => {
    assert.deepEqual(wrap('one two three', 7), ['one two', 'three']);
    assert.deepEqual(wrap('café—ok'), ['cafeok']);
    assert.deepEqual(wrap('  a   b  ', 3), ['a b']);
    assert.deepEqual(wrap('unbreakable word', 4), ['unbreakable', 'word']);
    assert.deepEqual(wrap(''), []);
  });

  it('lays a report out as sections of labelled values, skipping empty ones', () => {
    assert.deepEqual(
      fieldSections({
        pcrNumber: 'PCR-1',
        narrative: '',
        times: { unitNotifiedAt: '2026-10-01T10:00:00Z', arrivedAt: null },
        vitals: [{ heartRate: 88 }, { heartRate: 92 }],
        crew: []
      }),
      [
        { heading: 'Patient Care Report', rows: [{ label: 'Pcr Number', value: 'PCR-1' }] },
        { heading: 'Times', rows: [{ label: 'Unit Notified At', value: '2026-10-01T10:00:00Z' }] },
        {
          heading: 'Vitals',
          rows: [
            { label: 'Heart Rate', value: '88' },
            { label: 'Heart Rate', value: '92' }
          ]
        }
      ]
    );
    assert.deepEqual(fieldSections(null), []);
    assert.deepEqual(fieldSections([{ pcrNumber: 'PCR-1' }]), []);
    assert.deepEqual(fieldSections('PCR-1'), []);
  });

  it('gives no top section when the report has only nested values, under the heading given', () => {
    assert.deepEqual(
      fieldSections(
        { patient: { name: { last: 'Doe' }, transported: false, weightKg: 0 }, empty: {} },
        'Report'
      ),
      [
        {
          heading: 'Patient',
          rows: [
            { label: 'Last', value: 'Doe' },
            { label: 'Transported', value: 'false' },
            { label: 'Weight Kg', value: '0' }
          ]
        }
      ]
    );
    assert.deepEqual(fieldSections({ unit: 'M1', ok: true }, 'Report'), [
      {
        heading: 'Report',
        rows: [
          { label: 'Unit', value: 'M1' },
          { label: 'Ok', value: 'true' }
        ]
      }
    ]);
  });

  it('names the agency on every letterhead', () => {
    assert.deepEqual(letterhead(agency), [
      'Metro EMS',
      '1 Main St',
      'Springfield, IL 62701',
      'Phone: 2175550100'
    ]);
    assert.deepEqual(letterhead({ ...agency, addressLine: null, city: null, postalCode: null }), [
      'Metro EMS',
      'IL',
      'Phone: 2175550100'
    ]);
    assert.deepEqual(
      letterhead({ ...agency, addressLine: null, city: null, state: null, postalCode: null }),
      ['Metro EMS', 'Phone: 2175550100']
    );
  });

  it('renders sections across as many pages as they need', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ label: `Row ${i}`, value: 'x' }));
    const pdf = await renderDocument({
      title: 'Test',
      subtitle: 'Many rows',
      issuedOn: '2026-11-01',
      from: ['Metro EMS'],
      to: ['Someone'],
      sections: [{ heading: 'Rows', rows }]
    });
    assert.equal(await pagesOf(pdf), 3);
    assert.equal(await titleOf(pdf), 'Test - Many rows');
  });

  it('renders a row with an empty value on its own line', async () => {
    const pdf = await renderDocument({
      title: 'Test',
      subtitle: 'Blank',
      issuedOn: '2026-11-01',
      from: [],
      to: [],
      sections: [{ heading: 'Rows', rows: [{ label: 'Note', value: '' }] }]
    });
    assert.equal(await pagesOf(pdf), 1);
  });

  it('bundles the appeal letter, claim, report and the PDFs on the claim', async () => {
    const attachment = await renderDocument({
      title: 'PCS',
      subtitle: 'Signed',
      issuedOn: '2026-10-01',
      from: [],
      to: [],
      sections: []
    });
    const packet = await renderAppealPacket(
      {
        agency,
        payer: 'Medicare',
        level: 'Redetermination',
        dueOn: '2027-01-30',
        claim: [{ label: 'Claim', value: '20261002-0012' }],
        report: [{ heading: 'Narrative', rows: [{ label: '', value: 'Pt found down.' }] }],
        attachments: [attachment, new Uint8Array([1, 2, 3])]
      },
      '2026-11-01'
    );
    assert.equal(await pagesOf(packet), 2);
    assert.equal(await titleOf(packet), 'Redetermination - Due by 2027-01-30');
    assert.equal(await pagesOf(await appendPdfs(attachment, [])), 1);
  });

  it('keeps the producer and issue date of the document it appends to', async () => {
    const first = await renderDocument({
      title: 'Appeal',
      subtitle: 'Redetermination',
      issuedOn: '2026-11-01',
      from: [],
      to: [],
      sections: []
    });
    const merged = await PDFDocument.load(await appendPdfs(first, [first]), {
      updateMetadata: false
    });
    assert.equal(merged.getProducer(), 'ugula');
    assert.deepEqual(merged.getModificationDate(), new Date('2026-11-01T00:00:00Z'));
    assert.deepEqual(await appendPdfs(first, [first]), await appendPdfs(first, [first]));
  });

  it('subtitles an appeal without a due date as an appeal', async () => {
    const packet = await renderAppealPacket(
      {
        agency,
        payer: 'Blue Plan',
        level: 'Reconsideration',
        dueOn: null,
        claim: [],
        report: [],
        attachments: []
      },
      '2026-11-01'
    );
    assert.equal(await titleOf(packet), 'Reconsideration - Appeal');
  });

  it('totals what a facility owes on its monthly invoice', async () => {
    const claims = [
      {
        claimId: 'c12',
        number: '20261002-0012',
        pcrNumber: 'PCR-1',
        patient: 'Doe, Jane',
        serviceDate: '2026-10-02',
        chargeCents: 90_000,
        balanceCents: 90_000
      },
      {
        claimId: 'c13',
        number: '20261002-0013',
        pcrNumber: null,
        patient: 'Roe, Rich',
        serviceDate: null,
        chargeCents: 50_000,
        balanceCents: 20_000
      }
    ];
    assert.equal(invoiceTotal(claims), 110_000);
    const pdf = await renderFacilityInvoice(
      { facilityId: 'f1', agency, facility: ['Sunrise SNF'], period: '2026-10-01', claims },
      '2026-11-01'
    );
    assert.equal(await pagesOf(pdf), 1);
    assert.equal(await titleOf(pdf), 'Facility Invoice - Services through 2026-10');
    assert.equal(invoiceTotal([]), 0);
  });
});
