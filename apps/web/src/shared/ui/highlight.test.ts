import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nameKey } from '@ugula/billing';
import { createElement, type ReactElement } from 'react';
import { formatDate } from '../format.ts';
import { render } from '../testing-dom.ts';
import {
  DateHighlight,
  Highlight,
  highlightParts,
  NumberHighlight,
  prefixParts
} from './highlight.tsx';

const marked = (element: ReactElement) => {
  const { container, unmount } = render(element);
  const result = {
    text: container.textContent,
    marks: [...container.querySelectorAll('mark')].map((m) => m.textContent)
  };
  unmount();
  return result;
};

describe('highlightParts', () => {
  it('marks every case-insensitive match of the trimmed query and keeps the original text', () => {
    assert.deepEqual(highlightParts('Blue Cross blue', ' blue'), [
      { text: 'Blue', isMatch: true },
      { text: ' Cross ', isMatch: false },
      { text: 'blue', isMatch: true }
    ]);
  });

  it('marks back-to-back matches without overlapping', () => {
    assert.deepEqual(highlightParts('aaa', 'aa'), [
      { text: 'aa', isMatch: true },
      { text: 'a', isMatch: false }
    ]);
  });

  it('leaves the text whole for a blank query or no match', () => {
    assert.deepEqual(highlightParts('Aetna', ''), [{ text: 'Aetna', isMatch: false }]);
    assert.deepEqual(highlightParts('Aetna', '  '), [{ text: 'Aetna', isMatch: false }]);
    assert.deepEqual(highlightParts('Aetna', 'zz'), [{ text: 'Aetna', isMatch: false }]);
  });

  it('returns nothing for empty text', () => {
    assert.deepEqual(highlightParts('', 'x'), []);
    assert.deepEqual(highlightParts('', ''), []);
  });
});

describe('prefixParts', () => {
  it('marks only a match at the start', () => {
    assert.deepEqual(prefixParts('Brian', 'BR'), [
      { text: 'Br', isMatch: true },
      { text: 'ian', isMatch: false }
    ]);
    assert.deepEqual(prefixParts('Brian', 'an'), [{ text: 'Brian', isMatch: false }]);
  });

  it('marks the whole text when the query is all of it', () => {
    assert.deepEqual(prefixParts('Jo', 'jo'), [{ text: 'Jo', isMatch: true }]);
  });

  it('leaves text shorter than the query, a blank query and empty text unmarked', () => {
    assert.deepEqual(prefixParts('Jo', 'john'), [{ text: 'Jo', isMatch: false }]);
    assert.deepEqual(prefixParts('Jo', ' '), [{ text: 'Jo', isMatch: false }]);
    assert.deepEqual(prefixParts('', 'jo'), []);
  });

  it('compares by a key that ignores punctuation and accents', () => {
    assert.deepEqual(prefixParts("O'Brien", 'obr', nameKey), [
      { text: "O'Br", isMatch: true },
      { text: 'ien', isMatch: false }
    ]);
    assert.deepEqual(prefixParts('Muñoz', 'mun', nameKey), [
      { text: 'Muñ', isMatch: true },
      { text: 'oz', isMatch: false }
    ]);
  });

  it('keeps combining marks with the letter they belong to', () => {
    assert.deepEqual(prefixParts('Muñoz', 'mun', nameKey), [
      { text: 'Muñ', isMatch: true },
      { text: 'oz', isMatch: false }
    ]);
  });
});

describe('Highlight', () => {
  it('renders every match as a mark within the full text', () => {
    assert.deepEqual(marked(createElement(Highlight, { text: 'Medicare care', query: 'car' })), {
      text: 'Medicare care',
      marks: ['car', 'car']
    });
  });

  it('marks only the start in prefix mode', () => {
    assert.deepEqual(
      marked(createElement(Highlight, { text: 'Carecar', query: 'car', isPrefix: true })),
      { text: 'Carecar', marks: ['Car'] }
    );
  });
});

describe('NumberHighlight', () => {
  const show = (query: string) =>
    marked(createElement(NumberHighlight, { number: '20261105-0001', query }));

  it('marks the whole number when the search names it, however it was typed', () => {
    for (const query of ['20261105-0001', '#202611050001', ' 20261105-0001 ']) {
      assert.deepEqual(show(query), { text: '20261105-0001', marks: ['20261105-0001'] }, query);
    }
  });

  it('leaves other numbers and partial matches plain', () => {
    for (const query of ['', '20261105', '20261105-0002', '0001']) {
      assert.deepEqual(show(query), { text: '20261105-0001', marks: [] }, query);
    }
  });
});

describe('DateHighlight', () => {
  const shown = formatDate('1950-02-03');
  const show = (day: string | null, query: string) =>
    marked(createElement(DateHighlight, { day, query }));

  it('marks the whole formatted date when the search is that day', () => {
    assert.deepEqual(show('1950-02-03', ' 1950-02-03 '), { text: shown, marks: [shown] });
  });

  it('leaves the date plain for another day or no search', () => {
    assert.deepEqual(show('1950-02-03', '1950-02-04'), { text: shown, marks: [] });
    assert.deepEqual(show('1950-02-03', ''), { text: shown, marks: [] });
  });

  it('shows a missing date unmarked', () => {
    assert.deepEqual(show(null, '1950-02-03'), { text: formatDate(null), marks: [] });
  });
});
