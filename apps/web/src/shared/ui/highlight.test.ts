import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nameKey } from '@ugula/billing';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatDate } from '../format.ts';
import {
  DateHighlight,
  Highlight,
  highlightParts,
  NumberHighlight,
  prefixParts
} from './highlight.tsx';

describe('highlightParts', () => {
  it('marks every case-insensitive match and keeps the original text', () => {
    assert.deepEqual(highlightParts('Blue Cross blue', ' blue'), [
      { text: 'Blue', isMatch: true },
      { text: ' Cross ', isMatch: false },
      { text: 'blue', isMatch: true }
    ]);
    assert.deepEqual(highlightParts('Aetna', ''), [{ text: 'Aetna', isMatch: false }]);
    assert.deepEqual(highlightParts('', 'x'), []);
    assert.deepEqual(highlightParts('Aetna', 'zz'), [{ text: 'Aetna', isMatch: false }]);
  });

  it('renders matches as marks', () => {
    const html = renderToStaticMarkup(createElement(Highlight, { text: 'Medicare', query: 'car' }));
    assert.match(html, /^Medi<mark class="[^"]+">car<\/mark>e$/);
  });
});

describe('prefixParts', () => {
  it('marks only a match at the start, compared by a key that ignores accents and punctuation', () => {
    assert.deepEqual(prefixParts("O'Brien", 'obr', nameKey), [
      { text: "O'Br", isMatch: true },
      { text: 'ien', isMatch: false }
    ]);
    assert.deepEqual(prefixParts('Muñoz', 'mun', nameKey), [
      { text: 'Muñ', isMatch: true },
      { text: 'oz', isMatch: false }
    ]);
    assert.deepEqual(prefixParts('Muñoz', 'mun', nameKey)[0], { text: 'Muñ', isMatch: true });
    assert.deepEqual(prefixParts('Brian', 'an'), [{ text: 'Brian', isMatch: false }]);
    assert.deepEqual(prefixParts('Jo', 'john'), [{ text: 'Jo', isMatch: false }]);
    assert.deepEqual(prefixParts('Jo', 'jo'), [{ text: 'Jo', isMatch: true }]);
  });
});

describe('NumberHighlight', () => {
  const render = (query: string) =>
    renderToStaticMarkup(createElement(NumberHighlight, { number: '20261105-0001', query }));

  it('marks the whole number when the search names it, however it was typed', () => {
    for (const query of ['20261105-0001', '#202611050001', ' 20261105-0001 ']) {
      assert.match(render(query), /^<mark class="[^"]+">20261105-0001<\/mark>$/, query);
    }
  });

  it('leaves other numbers and partial matches plain', () => {
    for (const query of ['', '20261105', '20261105-0002', '0001']) {
      assert.equal(render(query), '20261105-0001', query);
    }
  });
});

describe('DateHighlight', () => {
  it('marks the whole formatted date only when the search is that day', () => {
    const shown = formatDate('1950-02-03');
    const html = (query: string) =>
      renderToStaticMarkup(createElement(DateHighlight, { day: '1950-02-03', query }));
    assert.equal(
      html('1950-02-03'),
      `<mark class="bg-warning/35 text-surface-fg [box-decoration-break:clone] px-px">${shown}</mark>`
    );
    assert.equal(html('1950-02-04'), shown);
    assert.equal(html(''), shown);
    assert.equal(
      renderToStaticMarkup(createElement(DateHighlight, { day: null, query: '1950-02-03' })),
      formatDate(null)
    );
  });
});
