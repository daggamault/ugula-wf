import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { filterXml, XmlTree, xmlNodes } from './xml-tree.tsx';

const report = {
  eRecord: { 'eRecord.01': 'PCR-1' },
  eVitals: { 'eVitals.VitalGroup': [{ 'eVitals.06': '120' }, { 'eVitals.06': '118' }] },
  eSituation: { 'eSituation.11': { '#text': 'R07.9', '@PN': '8801005' } }
};

const labelOf = (name: string) => ({ 'eRecord.01': 'PCR number', eVitals: 'Vitals' })[name] ?? null;

describe('xmlNodes', () => {
  it('turns parsed NEMSIS data into labelled elements with attributes and repeats', () => {
    const [root] = xmlNodes('PatientCareReport', report, labelOf);
    assert.deepEqual(
      root?.children.map((c) => [c.name, c.label, c.children.length]),
      [
        ['eRecord', null, 1],
        ['eVitals', 'Vitals', 2],
        ['eSituation', null, 1]
      ]
    );
    assert.deepEqual(root?.children[0]?.children[0], {
      name: 'eRecord.01',
      label: 'PCR number',
      attributes: [],
      text: 'PCR-1',
      children: []
    });
    const impression = root?.children[2]?.children[0];
    assert.deepEqual([impression?.text, impression?.attributes], ['R07.9', [['PN', '8801005']]]);
  });
});

describe('filterXml', () => {
  it('keeps matching elements with the path that leads to them', () => {
    const nodes = xmlNodes('PatientCareReport', report, labelOf);
    const [root] = filterXml(nodes, 'pcr number');
    assert.deepEqual(
      root?.children.map((c) => c.name),
      ['eRecord']
    );
    assert.equal(filterXml(nodes, '118')[0]?.children[0]?.children.length, 1);
    assert.deepEqual(filterXml(nodes, 'nothing here'), []);
    assert.equal(filterXml(nodes, '  ').length, 1);
  });
});

describe('XmlTree', () => {
  it('renders a searchable, collapsible element tree', () => {
    const html = renderToStaticMarkup(
      createElement(XmlTree, {
        label: 'Source report',
        rootName: 'PatientCareReport',
        value: report,
        labelOf
      })
    );
    assert.ok(html.includes('aria-label="Search Source report"'));
    assert.ok(html.includes('PCR number'));
    assert.ok(html.includes('PN=&quot;8801005&quot;'));
    assert.equal(html.match(/<details open=""/g)?.length, 4);
    assert.equal(html.match(/<details class=/g)?.length, 2);
  });
});
