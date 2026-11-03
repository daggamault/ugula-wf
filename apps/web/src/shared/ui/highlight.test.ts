import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nameKey } from '@ugula/billing';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Highlight, highlightParts, prefixParts } from './highlight.tsx';

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
