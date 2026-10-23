import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describedByOf, errorIdOf, Field, hintIdOf } from './field.tsx';

describe('Field', () => {
  it('labels a control and shows errors before hints', () => {
    const html = renderToStaticMarkup(
      createElement(Field, { id: 'x', label: 'X', error: 'Bad', hint: 'Help', children: 'control' })
    );
    assert.ok(html.includes('for="x"'));
    assert.ok(html.includes(`id="${errorIdOf('x')}"`));
    assert.ok(!html.includes('Help'));
  });

  it('marks required fields and links hints', () => {
    const html = renderToStaticMarkup(
      createElement(Field, { id: 'x', label: 'X', hint: 'Help', isRequired: true, children: 'c' })
    );
    assert.ok(html.includes('>*</span>'));
    assert.ok(html.includes(`id="${hintIdOf('x')}"`));
    assert.equal(describedByOf('x', undefined, 'Help'), hintIdOf('x'));
    assert.equal(describedByOf('x', 'Bad', 'Help'), errorIdOf('x'));
    assert.equal(describedByOf('x'), undefined);
  });
});
