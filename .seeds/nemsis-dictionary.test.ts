import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { deflateRawSync, gzipSync } from 'node:zlib';
import { createDummyDb } from '@ugula/db/testing';
import { buildDictionary, CODES_FILE, ELEMENTS_FILE } from './nemsis-build.ts';
import {
  buildUpsertCodes,
  buildUpsertElements,
  codesToTsv,
  elementsToTsv,
  mergeDictionaries,
  NEMSIS_RELEASES,
  parseXsds,
  readCodes,
  readElements,
  xsdZipUrl
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

  it('ship with the seed and describe common values', () => {
    const elements = readElements(readFileSync(ELEMENTS_FILE));
    const codes = readCodes(readFileSync(CODES_FILE));
    assert.equal(
      elements.find((e) => e.element === 'eResponse.05')?.name,
      'Type of Service Requested'
    );
    assert.equal(
      codes.find((c) => c.list === 'eResponse.05' && c.code === '2205001')?.description,
      'Emergency Response (Primary Response Area)'
    );
    assert.equal(
      codes.find((c) => c.list === '@NV' && c.code === '7701003')?.description,
      'Not Recorded'
    );
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

const zipOf = (files: Record<string, string>) => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(text));
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
};

describe('buildDictionary', () => {
  it('downloads every 3.5 release and merges their XSDs', async () => {
    const urls: string[] = [];
    const dictionary = await buildDictionary(async (url) => {
      urls.push(url);
      return zipOf({
        'X/eResponse_v3.xsd': SECTION,
        'X/commonTypes_v3.xsd': COMMON,
        'X/a.txt': ''
      });
    });
    assert.deepEqual(urls, NEMSIS_RELEASES.map(xsdZipUrl));
    assert.equal(dictionary.elements.length, 2);
    assert.equal(dictionary.codes.length, 6);
  });
});
