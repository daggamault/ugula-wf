import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, within } from '../testing-dom.ts';
import {
  describedByOf,
  errorIdOf,
  Field,
  FieldGroup,
  FieldSet,
  fieldControlClasses,
  hintIdOf
} from './field.tsx';

type FieldProps = Parameters<typeof Field>[0];

const showField = (props: Partial<FieldProps> = {}) => {
  const { error, hint } = props;
  render(
    createElement(Field, {
      id: 'npi',
      label: 'NPI',
      ...props,
      children: createElement('input', {
        id: 'npi',
        'aria-describedby': describedByOf('npi', error, hint)
      })
    })
  );
};

describe('Field', () => {
  it('labels its control', () => {
    showField();
    screen.getByRole('textbox', { name: 'NPI' });
  });

  it('describes the control by its hint', () => {
    showField({ hint: '10 digits' });
    const input = screen.getByRole('textbox', { name: 'NPI', description: '10 digits' });
    assert.equal(input.getAttribute('aria-describedby'), hintIdOf('npi'));
  });

  it('announces an error in place of the hint and describes the control by it', () => {
    showField({ error: 'Must be 10 digits', hint: '10 digits' });
    assert.equal(screen.getByRole('alert').textContent, 'Must be 10 digits');
    assert.equal(screen.getByRole('alert').id, errorIdOf('npi'));
    screen.getByRole('textbox', { name: 'NPI', description: 'Must be 10 digits' });
    assert.ok(!screen.queryByText('10 digits'));
  });

  it('marks required fields with a decorative asterisk kept out of the name', () => {
    showField({ isRequired: true });
    screen.getByRole('textbox', { name: 'NPI' });
    const star = screen.getByText('*');
    assert.equal(star.getAttribute('aria-hidden'), 'true');
  });

  it('hides the label visually while still naming the control', () => {
    showField({ isLabelHidden: true });
    screen.getByRole('textbox', { name: 'NPI' });
    assert.equal(screen.getByText('NPI').classList.contains('sr-only'), true);
  });

  it('spans one, two or four grid columns on wider containers', () => {
    const spans = ([1, 2, 4] as const).map((span) => {
      const { container, unmount } = render(
        createElement(Field, { id: 'x', label: 'X', span, children: null })
      );
      const classes = [...(container.firstElementChild?.classList ?? [])];
      unmount();
      return classes.filter((c) => c.includes('col-span'));
    });
    assert.deepEqual(spans, [[], ['@lg:col-span-2'], ['@lg:col-span-2', '@3xl:col-span-4']]);
  });
});

describe('describedByOf', () => {
  it('points at the error first, then the hint, then nothing', () => {
    assert.equal(describedByOf('x', 'Bad', 'Help'), 'x-error');
    assert.equal(describedByOf('x', undefined, 'Help'), 'x-hint');
    assert.equal(describedByOf('x'), undefined);
  });
});

describe('fieldControlClasses', () => {
  it('rings focus, borders invalid controls in danger and dims disabled ones', () => {
    const classes = fieldControlClasses.split(' ');
    for (const c of [
      'focus-visible:outline-primary',
      'aria-invalid:border-danger',
      'disabled:cursor-not-allowed',
      'disabled:opacity-50'
    ]) {
      assert.equal(classes.includes(c), true, c);
    }
  });
});

describe('FieldGroup', () => {
  it('is a region named by its section heading', () => {
    render(createElement(FieldGroup, { title: 'Patient', children: 'fields' }));
    const group = screen.getByRole('region', { name: 'Patient' });
    within(group).getByRole('heading', { level: 3, name: 'Patient' });
  });
});

describe('FieldSet', () => {
  it('groups nested fields under a legend', () => {
    render(
      createElement(FieldSet, {
        label: 'Address',
        children: createElement('input', { 'aria-label': 'Street' })
      })
    );
    const group = screen.getByRole('group', { name: 'Address' });
    within(group).getByRole('textbox', { name: 'Street' });
  });
});
