import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  describedByOf,
  errorIdOf,
  Field,
  FieldGroup,
  FormActions,
  fieldControlClasses,
  hintIdOf
} from './field.tsx';

describe('Field', () => {
  it('labels a control and shows errors before hints', () => {
    const html = renderToStaticMarkup(
      createElement(Field, { id: 'x', label: 'X', error: 'Bad', hint: 'Help', children: 'control' })
    );
    assert.ok(html.includes('for="x"'));
    assert.ok(html.includes(`<p id="${errorIdOf('x')}" role="alert"`));
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

  it('spans grid columns on wider containers', () => {
    const html = (span: 1 | 2 | 4) =>
      renderToStaticMarkup(createElement(Field, { id: 'x', label: 'X', span, children: 'c' }));
    assert.ok(!html(1).includes('col-span'));
    assert.ok(html(2).includes('@lg:col-span-2') && !html(2).includes('@3xl:col-span-4'));
    assert.ok(html(4).includes('@3xl:col-span-4'));
  });

  it('gives controls a focus ring, hover surface and disabled state', () => {
    assert.ok(fieldControlClasses.includes('focus-visible:outline-primary'));
    assert.ok(fieldControlClasses.includes('hover:bg-surface-hover'));
    assert.ok(fieldControlClasses.includes('aria-invalid:border-danger'));
    assert.ok(fieldControlClasses.includes('disabled:cursor-not-allowed'));
  });
});

describe('FieldGroup', () => {
  it('labels a group of fields by its section title', () => {
    const html = renderToStaticMarkup(
      createElement(FieldGroup, { title: 'Patient', children: 'fields' })
    );
    assert.match(
      html,
      /<section aria-labelledby="([^"]+)".*<h3 id="\1" class="text-base font-bold">/
    );
    assert.ok(html.includes('>Patient</h3>'));
  });
});

describe('FormActions', () => {
  it('stacks full-width buttons on phones and right-aligns them from small screens up', () => {
    const html = renderToStaticMarkup(createElement(FormActions, null, 'Save'));
    assert.ok(html.includes('flex-col-reverse') && html.includes('sm:justify-end'));
    assert.ok(html.includes('gap-2'));
  });
});
