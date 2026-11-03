import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { buildDictionary, CODES_FILE, ELEMENTS_FILE } from './nemsis-build.ts';
import { NEMSIS_RELEASES, readCodes, readElements, xsdZipUrl } from './nemsis-dictionary.ts';
import { zipOf } from './testing.ts';

const XS = 'xmlns:xs="http://www.w3.org/2001/XMLSchema"';

const enumeration = (code: string, label: string) =>
  `<xs:enumeration value="${code}"><xs:annotation><xs:documentation>${label}</xs:documentation></xs:annotation></xs:enumeration>`;

const xsd = (...codes: string[]) => `<xs:schema ${XS}>
  <xs:element name="eDisposition.12" type="Disposition"><xs:annotation><xs:documentation><nemsisTacDoc>
    <name>Incident/Patient Disposition</name><definition>Outcome</definition><usage>Required</usage>
  </nemsisTacDoc></xs:documentation></xs:annotation></xs:element>
  <xs:simpleType name="Disposition"><xs:restriction base="xs:string">${codes.join('')}</xs:restriction></xs:simpleType>
</xs:schema>`;

describe('buildDictionary', () => {
  it('downloads every release, oldest first, so later releases win and retired codes stay', async () => {
    const urls: string[] = [];
    const dictionary = await buildDictionary(async (url) => {
      urls.push(url);
      return zipOf({
        'X/eDisposition_v3.xsd': url.includes('3.4.0')
          ? xsd(enumeration('4212001', 'Old label'), enumeration('4212999', 'Retired'))
          : xsd(enumeration('4212001', 'Assist, Agency')),
        'X/readme.txt': ''
      });
    });
    assert.deepEqual(urls, NEMSIS_RELEASES.map(xsdZipUrl));
    assert.equal(NEMSIS_RELEASES[0], '3.4.0');
    assert.deepEqual(
      dictionary.codes.map((c) => [c.code, c.description]),
      [
        ['4212001', 'Assist, Agency'],
        ['4212999', 'Retired']
      ]
    );
    assert.equal(dictionary.elements[0]?.name, 'Incident/Patient Disposition');
  });

  it('fails on a release without XSDs', async () => {
    await assert.rejects(
      () => buildDictionary(async () => zipOf({ 'readme.txt': '' })),
      /No XSDs in NEMSIS 3.4.0/
    );
  });

  it('ships with the seed and describes 3.4 and 3.5 values', () => {
    const elements = readElements(readFileSync(ELEMENTS_FILE));
    const codes = readCodes(readFileSync(CODES_FILE));
    const describe = (list: string, code: string) =>
      codes.find((c) => c.list === list && c.code === code)?.description;
    assert.equal(
      elements.find((e) => e.element === 'eResponse.05')?.name,
      'Type of Service Requested'
    );
    assert.equal(describe('eResponse.05', '2205001'), 'Emergency Response (Primary Response Area)');
    assert.equal(describe('@NV', '7701003'), 'Not Recorded');
    assert.equal(describe('eDisposition.12', '4212001'), 'Assist, Agency');
  });
});
