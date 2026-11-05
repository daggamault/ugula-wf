import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { matchesOf, Select, SelectControl, summaryOf, typeaheadIndex } from './select.tsx';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' }
];

const many = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ value: String(i), label: `Option ${i}` }));

const noop = () => undefined;

describe('summaryOf', () => {
  it('shows nothing, one label or the first label and a count', () => {
    assert.equal(summaryOf(OPTIONS, []), null);
    assert.equal(summaryOf(OPTIONS, ['b']), 'Beta');
    assert.equal(summaryOf(OPTIONS, ['a', 'c']), 'Alpha +1');
    assert.equal(summaryOf(OPTIONS, ['a', 'b', 'c']), 'Alpha +2');
  });

  it('ignores values with no option', () => {
    assert.equal(summaryOf(OPTIONS, ['x']), null);
    assert.equal(summaryOf(OPTIONS, ['x', 'b']), 'Beta');
  });
});

describe('matchesOf', () => {
  it('keeps every option for a blank query', () => {
    assert.deepEqual(matchesOf(OPTIONS, ''), OPTIONS);
    assert.deepEqual(matchesOf(OPTIONS, '   '), OPTIONS);
  });

  it('matches labels case-insensitively anywhere in the label', () => {
    assert.deepEqual(
      matchesOf(OPTIONS, ' MM ').map((o) => o.value),
      ['c']
    );
    assert.deepEqual(
      matchesOf(OPTIONS, 'a').map((o) => o.value),
      ['a', 'b', 'c']
    );
    assert.deepEqual(matchesOf(OPTIONS, 'zeta'), []);
  });
});

describe('Select', () => {
  it('labels a listbox trigger and lists the options', () => {
    const html = renderToStaticMarkup(
      createElement(Select, {
        id: 'kind',
        label: 'Kind',
        options: OPTIONS,
        value: 'b',
        onChange: noop
      })
    );
    assert.ok(html.includes('for="kind"'));
    assert.match(html, /<button [^>]*id="kind"[^>]*aria-haspopup="listbox"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /aria-controls="kind-panel"/);
    assert.match(html, /aria-haspopup="listbox"[^>]*><span[^>]*>Beta<\/span><\/button>/);
    assert.match(html, /<div [^>]*id="kind-list"[^>]*role="listbox"[^>]*aria-label="Kind"/);
    assert.ok(!html.includes('aria-multiselectable'));
    assert.match(html, /role="option"[^>]*aria-selected="true" data-value="b"/);
    assert.match(html, /role="option"[^>]*aria-selected="false" data-value="a"/);
    assert.ok(
      html.includes('h-10') && html.includes('rounded-lg') && html.includes('cursor-pointer')
    );
    assert.ok(!html.includes('aria-invalid=') && !html.includes('aria-describedby'));
  });

  it('shows the placeholder until a value is chosen', () => {
    const html = renderToStaticMarkup(
      createElement(Select, {
        id: 'kind',
        label: 'Kind',
        placeholder: 'Choose a kind',
        options: OPTIONS,
        value: '',
        onChange: noop
      })
    );
    assert.match(
      html,
      /aria-haspopup="listbox"[^>]*><span class="[^"]*text-surface-fg-muted[^"]*">Choose a kind<\/span>/
    );
    assert.ok(!html.includes('aria-selected="true"'));
  });

  it('links an error to the trigger', () => {
    const html = renderToStaticMarkup(
      createElement(Select, {
        id: 'payer',
        label: 'Payer',
        error: 'Pick one',
        options: [],
        value: '',
        onChange: noop
      })
    );
    assert.match(html, /<button [^>]*aria-invalid="true"[^>]*aria-describedby="payer-error"/);
    assert.ok(html.includes('id="payer-error"'));
    assert.match(html, /role="listbox"[^>]*><\/div><p[^>]*>No matches<\/p>/);
  });

  it('submits the chosen value through a hidden input', () => {
    const html = renderToStaticMarkup(
      createElement(Select, {
        id: 'kind',
        label: 'Kind',
        name: 'kind',
        options: OPTIONS,
        value: 'c',
        onChange: noop
      })
    );
    assert.ok(html.includes('<input type="hidden" name="kind" value="c"/>'));
    assert.equal(html.match(/type="hidden"/g)?.length, 1);
  });

  it('submits only with a name, sending a blank choice like a native select', () => {
    const unnamed = renderToStaticMarkup(
      createElement(Select, { id: 'k', label: 'K', options: OPTIONS, value: 'a', onChange: noop })
    );
    const blank = renderToStaticMarkup(
      createElement(Select, {
        id: 'k',
        label: 'K',
        name: 'k',
        options: [{ value: '', label: 'Any' }, ...OPTIONS],
        value: '',
        onChange: noop
      })
    );
    assert.ok(!unnamed.includes('type="hidden"'));
    assert.ok(blank.includes('<input type="hidden" name="k" value=""/>'));
    assert.match(
      blank,
      /aria-haspopup="listbox"[^>]*><span class="truncate">Any<\/span><\/button>/
    );
    assert.match(blank, /role="option"[^>]*aria-selected="true" data-value=""/);
  });
});

describe('SelectControl', () => {
  it('names a bare trigger with aria-label and draws a decorative chevron', () => {
    const html = renderToStaticMarkup(
      createElement(SelectControl, {
        'aria-label': 'Rows',
        options: [{ value: '10', label: '10' }],
        value: '10',
        onChange: noop
      })
    );
    assert.match(html, /<button [^>]*aria-haspopup="listbox"[^>]*aria-label="Rows"/);
    assert.ok(!html.includes('<label'));
    assert.match(html, /role="listbox"[^>]*aria-label="Rows"/);
    assert.match(html, /<svg[^>]*aria-hidden="true"/);
  });

  it('selects several values and summarises them', () => {
    const html = renderToStaticMarkup(
      createElement(SelectControl, {
        id: 'tags',
        isMultiple: true,
        name: 'tags',
        options: OPTIONS,
        value: ['a', 'c'],
        onChange: noop
      })
    );
    assert.ok(html.includes('aria-multiselectable="true"'));
    assert.equal(html.match(/aria-selected="true"/g)?.length, 2);
    assert.match(html, /aria-haspopup="listbox"[^>]*><span[^>]*>Alpha \+1<\/span><\/button>/);
    assert.ok(html.includes('<input type="hidden" name="tags" value="a"/>'));
    assert.ok(html.includes('<input type="hidden" name="tags" value="c"/>'));
  });

  it('adds a search box only past seven options or when asked', () => {
    const render = (options: { value: string; label: string }[], isSearchable?: boolean) =>
      renderToStaticMarkup(
        createElement(SelectControl, {
          'aria-label': 'Pick',
          options,
          value: '',
          onChange: noop,
          isSearchable
        })
      );
    assert.ok(!render(many(7)).includes('role="combobox"'));
    assert.match(render(many(8)), /<input [^>]*type="search"[^>]*role="combobox"/);
    assert.match(render(OPTIONS, true), /role="combobox"[^>]*aria-label="Search Pick"/);
    assert.ok(!render(many(8), false).includes('role="combobox"'));
    const labelled = renderToStaticMarkup(
      createElement(Select, { id: 'k', label: 'Kind', options: many(8), value: '', onChange: noop })
    );
    assert.match(labelled, /role="combobox"[^>]*aria-label="Search Kind"/);
  });
});

describe('typeaheadIndex', () => {
  const options = ['All', 'Failed', 'Faulted', 'Running'].map((label) => ({ value: label, label }));

  it('matches what was typed as a prefix, starting at the active option', () => {
    assert.equal(typeaheadIndex(options, 'fau', 0), 2);
    assert.equal(typeaheadIndex(options, 'fa', 1), 1);
    assert.equal(typeaheadIndex(options, 'x', 0), -1);
  });

  it('cycles through options sharing a letter when the letter repeats', () => {
    assert.equal(typeaheadIndex(options, 'f', 1), 2);
    assert.equal(typeaheadIndex(options, 'ff', 2), 1);
  });
});
