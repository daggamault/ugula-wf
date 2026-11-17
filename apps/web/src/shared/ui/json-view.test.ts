import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen } from '../testing-dom.ts';
import { JsonView } from './json-view.tsx';

const shownJson = (value: unknown) => {
  render(createElement(JsonView, { label: 'Inputs', value }));
  return screen.getByRole('figure').querySelector('pre')?.textContent;
};

describe('JsonView', () => {
  it('is a figure captioned, for screen readers only, by its label', () => {
    render(createElement(JsonView, { label: 'Inputs', value: {} }));
    const caption = screen.getByRole('figure').querySelector('figcaption');
    assert.equal(caption?.textContent, 'Inputs');
    assert.ok(caption?.classList.contains('sr-only'));
  });

  it('pretty prints objects with two-space indentation', () => {
    assert.equal(
      shownJson({ a: 1, b: [true, 'x'] }),
      '{\n  "a": 1,\n  "b": [\n    true,\n    "x"\n  ]\n}'
    );
  });

  it('prints strings as JSON', () => {
    assert.equal(shownJson('text'), '"text"');
  });

  it('prints null as JSON', () => {
    assert.equal(shownJson(null), 'null');
  });

  it('shows a dash for a missing value', () => {
    assert.equal(shownJson(undefined), '—');
  });
});
