import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';
import { createDummyDb } from '@ugula/db/testing';
import {
  buildUpsertCodes,
  buildUpsertElements,
  codesToTsv,
  elementsToTsv,
  mergeDictionaries,
  parseXsds,
  readCodes,
  readElements
} from './nemsis-dictionary.ts';

const XS = 'xmlns:xs="http://www.w3.org/2001/XMLSchema"';

const enumeration = (value: string, label: string) =>
  `<xs:enumeration value="${value}"><xs:annotation><xs:documentation>${label}</xs:documentation></xs:annotation></xs:enumeration>`;

const doc = (number: string, name: string) => `<xs:annotation><xs:documentation><nemsisTacDoc>
  <number>${number}</number><name>${name}</name>
  <definition>What ${name}
    means.</definition><usage>Mandatory</usage>
</nemsisTacDoc></xs:documentation></xs:annotation>`;

const COMMON = `<xs:schema ${XS}>
  <xs:simpleType name="NV.NotApplicable"><xs:restriction base="xs:string">${enumeration('7701001', 'Not Applicable')}</xs:restriction></xs:simpleType>
  <xs:simpleType name="NV.NotRecorded"><xs:restriction base="xs:string">${enumeration('7701003', 'Not Recorded')}</xs:restriction></xs:simpleType>
  <xs:simpleType name="YesNo"><xs:restriction base="xs:string">${enumeration('9923001', 'No')}${enumeration('9923003', 'Yes')}</xs:restriction></xs:simpleType>
</xs:schema>`;

const SECTION = `<xs:schema ${XS}>
  <xs:complexType name="eResponse"><xs:sequence>
    <xs:element name="eResponse.05" type="ServiceCat">${doc('eResponse.05', 'Type of Service Requested')}</xs:element>
    <xs:element name="eResponse.08">${doc('eResponse.08', 'Delay')}
      <xs:complexType><xs:simpleContent><xs:extension base="YesNo">
        <xs:attribute name="NV"><xs:simpleType><xs:union memberTypes="NV.NotApplicable NV.NotRecorded"/></xs:simpleType></xs:attribute>
      </xs:extension></xs:simpleContent></xs:complexType>
    </xs:element>
    <xs:element name="eResponse.AgencyGroup" type="xs:string"/>
  </xs:sequence></xs:complexType>
  <xs:simpleType name="ServiceCat"><xs:restriction base="xs:string">
    ${enumeration('2205001', 'Emergency Response (Primary Response Area)')}
    ${enumeration('2205003', 'Emergency Response (Intercept)')}
  </xs:restriction></xs:simpleType>
</xs:schema>`;

describe('parseXsds', () => {
  const dictionary = parseXsds([SECTION, COMMON]);

  it('reads numbered elements with one-line definitions and skips groups', () => {
    assert.deepEqual(dictionary.elements, [
      {
        element: 'eResponse.05',
        name: 'Type of Service Requested',
        definition: 'What Type of Service Requested means.',
        usage: 'Mandatory'
      },
      {
        element: 'eResponse.08',
        name: 'Delay',
        definition: 'What Delay means.',
        usage: 'Mandatory'
      }
    ]);
  });

  it('resolves code lists through named, derived and union types', () => {
    assert.deepEqual(dictionary.codes, [
      { list: '@NV', code: '7701001', description: 'Not Applicable' },
      { list: '@NV', code: '7701003', description: 'Not Recorded' },
      {
        list: 'eResponse.05',
        code: '2205001',
        description: 'Emergency Response (Primary Response Area)'
      },
      { list: 'eResponse.05', code: '2205003', description: 'Emergency Response (Intercept)' },
      { list: 'eResponse.08', code: '9923001', description: 'No' },
      { list: 'eResponse.08', code: '9923003', description: 'Yes' }
    ]);
  });
});

describe('mergeDictionaries', () => {
  it('lets later releases win and keeps values only older releases had', () => {
    const merged = mergeDictionaries(
      {
        elements: [{ element: 'e.01', name: 'Old', definition: '', usage: '' }],
        codes: [
          { list: 'e.01', code: '1', description: 'Old one' },
          { list: 'e.01', code: '2', description: 'Retired' }
        ]
      },
      {
        elements: [{ element: 'e.01', name: 'New', definition: '', usage: '' }],
        codes: [{ list: 'e.01', code: '1', description: 'New one' }]
      }
    );
    assert.equal(merged.elements[0]?.name, 'New');
    assert.deepEqual(
      merged.codes.map((c) => c.description),
      ['New one', 'Retired']
    );
  });
});

describe('dictionary files', () => {
  it('round-trip elements and codes through gzipped TSV', () => {
    const { elements, codes } = parseXsds([SECTION, COMMON]);
    assert.deepEqual(readElements(gzipSync(elementsToTsv(elements))), elements);
    assert.deepEqual(readCodes(gzipSync(codesToTsv(codes))), codes);
  });
});

describe('dictionary upserts', () => {
  it('update existing rows by their keys', async () => {
    const db = createDummyDb();
    const elements = buildUpsertElements(db, [
      { element: 'e.01', name: 'N', definition: 'D', usage: 'U' }
    ]).compile().sql;
    assert.ok(elements.includes('insert into "nemsis_elements"'));
    assert.ok(elements.includes('on conflict ("element") do update'));
    const codes = buildUpsertCodes(db, [{ list: 'e.01', code: '1', description: 'One' }]).compile()
      .sql;
    assert.ok(codes.includes('on conflict ("list", "code") do update'));
    await db.destroy();
  });
});
