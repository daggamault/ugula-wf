import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent } from '../testing-dom.ts';
import { filterXml, XmlTree, xmlNodes } from './xml-tree.tsx';

const report = {
  eRecord: { 'eRecord.01': 'PCR-1' },
  eVitals: { 'eVitals.VitalGroup': [{ 'eVitals.06': '120' }, { 'eVitals.06': '118' }] },
  eSituation: { 'eSituation.11': { '#text': 'R07.9', '@PN': '8801005' } }
};

const LABELS: Record<string, string> = { 'eRecord.01': 'PCR Number', eVitals: 'Vitals' };

const labelOf = (name: string) => LABELS[name] ?? null;

const MEANINGS: Record<string, string> = {
  'eSituation.11:R07.9': 'Chest pain',
  '@PN:8801005': 'Exam Finding Not Present'
};

const meaningOf = (name: string, value: string) => MEANINGS[`${name}:${value}`] ?? null;

const namesOf = (nodes: readonly { name: string }[] | undefined) => nodes?.map((n) => n.name);

describe('xmlNodes', () => {
  it('makes a leaf of a scalar root, stringifying numbers and blanking null', () => {
    assert.deepEqual(xmlNodes('n', 5), [
      { path: '0', name: 'n', label: null, attributes: [], text: '5', meaning: null, children: [] }
    ]);
    assert.equal(xmlNodes('n', null)[0]?.text, '');
  });

  it('nests elements with dotted paths and labels', () => {
    const [root] = xmlNodes('PatientCareReport', report, labelOf);
    assert.deepEqual(
      root?.children.map((c) => [c.path, c.name, c.label, c.children.length]),
      [
        ['0.0', 'eRecord', null, 1],
        ['0.1', 'eVitals', 'Vitals', 2],
        ['0.2', 'eSituation', null, 1]
      ]
    );
    assert.deepEqual(root?.children[0]?.children[0], {
      path: '0.0.0',
      name: 'eRecord.01',
      label: 'PCR Number',
      attributes: [],
      text: 'PCR-1',
      meaning: null,
      children: []
    });
  });

  it('repeats an element for each item of a list', () => {
    const [, vitals] = xmlNodes('PatientCareReport', report)[0]?.children ?? [];
    assert.deepEqual(
      vitals?.children.map((c) => [c.path, c.name, c.children[0]?.text]),
      [
        ['0.1.0', 'eVitals.VitalGroup', '120'],
        ['0.1.1', 'eVitals.VitalGroup', '118']
      ]
    );
  });

  it('reads attributes and own text, each with its meaning', () => {
    const impression = xmlNodes('r', report, labelOf, meaningOf)[0]?.children[2]?.children[0];
    assert.deepEqual(impression, {
      path: '0.2.0',
      name: 'eSituation.11',
      label: null,
      attributes: [{ name: 'PN', value: '8801005', meaning: 'Exam Finding Not Present' }],
      text: 'R07.9',
      meaning: 'Chest pain',
      children: []
    });
  });

  it('leaves the text of an element without its own text null', () => {
    assert.equal(xmlNodes('r', { a: '1' })[0]?.text, null);
  });

  it('looks up no meaning for blank text or attributes', () => {
    const asked: string[] = [];
    xmlNodes('r', { '@A': '', '#text': '', b: null }, labelOf, (name, value) => {
      asked.push(`${name}:${value}`);
      return null;
    });
    assert.deepEqual(asked, []);
  });
});

describe('filterXml', () => {
  const nodes = xmlNodes('PatientCareReport', report, labelOf, meaningOf);

  it('keeps everything for a blank query', () => {
    assert.deepEqual(filterXml(nodes, '  '), nodes);
  });

  it('keeps a match with the path that leads to it', () => {
    const [root] = filterXml(nodes, 'PCR number');
    assert.deepEqual(namesOf(root?.children), ['eRecord']);
    assert.deepEqual(namesOf(root?.children[0]?.children), ['eRecord.01']);
  });

  it('keeps only the matching repeat', () => {
    const vitals = filterXml(nodes, '118')[0]?.children[0];
    assert.equal(vitals?.children.length, 1);
    assert.equal(vitals?.children[0]?.path, '0.1.1');
  });

  it('keeps all children of a matching element', () => {
    assert.equal(filterXml(nodes, ' VITALS ')[0]?.children[0]?.children.length, 2);
  });

  it('matches text meanings, attribute names, values and meanings', () => {
    for (const query of ['chest pain', 'pn', '8801005', 'finding not present']) {
      assert.deepEqual(namesOf(filterXml(nodes, query)[0]?.children), ['eSituation'], query);
    }
  });

  it('keeps nothing when nothing matches', () => {
    assert.deepEqual(filterXml(nodes, 'nothing here'), []);
  });
});

describe('XmlTree', () => {
  const showTree = () => {
    render(
      createElement(XmlTree, {
        label: 'Source Report',
        rootName: 'PatientCareReport',
        value: report,
        labelOf,
        meaningOf
      })
    );
    const figure = screen.getByRole('figure', { name: 'Source Report' });
    const elementNamed = (name: string) =>
      [...figure.querySelectorAll('details')].find((d) =>
        d.querySelector('summary')?.textContent?.startsWith(`<${name}>`)
      );
    const openState = () =>
      [...figure.querySelectorAll('details')].map((d) => [
        d.querySelector('summary > span')?.textContent,
        d.open
      ]);
    return { figure, elementNamed, openState, user: userEvent.setup() };
  };

  it('is a figure with a search box named after it', () => {
    showTree();
    const search = screen.getByRole<HTMLInputElement>('searchbox', {
      name: 'Search Source Report'
    });
    assert.equal(search.placeholder, 'Find an element, label or value');
  });

  it('opens the first two levels and folds deeper elements', () => {
    const { openState } = showTree();
    assert.deepEqual(openState(), [
      ['<PatientCareReport>', true],
      ['<eRecord>', true],
      ['<eVitals>', true],
      ['<eVitals.VitalGroup>', false],
      ['<eVitals.VitalGroup>', false],
      ['<eSituation>', true]
    ]);
  });

  it('counts the children of an element in its summary', () => {
    const { elementNamed } = showTree();
    assert.equal(
      elementNamed('eVitals')?.querySelector('summary')?.textContent,
      '<eVitals>Vitals … 2'
    );
  });

  it('shows each leaf as an element with its text, meaning and label', () => {
    const { figure } = showTree();
    const leaves = [...figure.querySelectorAll('li:not(:has(details))')].map(
      (li) => li.textContent
    );
    assert.deepEqual(leaves, [
      '<eRecord.01>PCR-1</eRecord.01>PCR Number',
      '<eVitals.06>120</eVitals.06>',
      '<eVitals.06>118</eVitals.06>',
      '<eSituation.11 PN="8801005" (Exam Finding Not Present)>R07.9</eSituation.11>Chest pain'
    ]);
  });

  it('folds and unfolds an element from its summary', async () => {
    const { elementNamed, user } = showTree();
    const vitals = elementNamed('eVitals');
    const summary = vitals?.querySelector('summary');
    assert.ok(summary);
    await user.click(summary);
    assert.equal(vitals?.open, false);
    await user.click(summary);
    assert.equal(vitals?.open, true);
  });

  it('shows only matches, unfolded, while searching', async () => {
    const { figure, openState, user } = showTree();
    await user.type(screen.getByRole('searchbox'), '118');
    assert.deepEqual(openState(), [
      ['<PatientCareReport>', true],
      ['<eVitals>', true],
      ['<eVitals.VitalGroup>', true]
    ]);
    assert.ok(figure.textContent?.includes('<eVitals.06>118</eVitals.06>'));
    assert.ok(!figure.textContent?.includes('120'));
  });

  it('keeps an element the user folded folded, even while searching', async () => {
    const { elementNamed, user } = showTree();
    const summary = elementNamed('eVitals')?.querySelector('summary');
    assert.ok(summary);
    await user.click(summary);
    await user.type(screen.getByRole('searchbox'), '118');
    assert.equal(elementNamed('eVitals')?.open, false);
  });

  it('says when nothing matches the search', async () => {
    const { figure, user } = showTree();
    await user.type(screen.getByRole('searchbox'), 'zzz');
    assert.equal(figure.querySelectorAll('li').length, 0);
    screen.getByText('Nothing in this report matches “zzz”.');
  });
});
