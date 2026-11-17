import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement, useState } from 'react';
import { render, screen, userEvent } from '../testing-dom.ts';
import { Input, type InputProps } from './input.tsx';

const showInput = (props: Partial<InputProps> = {}) => {
  render(createElement(Input, { id: 'email', label: 'Email', ...props }));
  return screen.getByRole<HTMLInputElement>('textbox', { name: 'Email' });
};

describe('Input', () => {
  it('is a textbox named by its label, valid and undescribed by default', () => {
    const input = showInput();
    assert.equal(input.id, 'email');
    assert.equal(input.getAttribute('aria-invalid'), null);
    assert.equal(input.getAttribute('aria-describedby'), null);
    assert.equal(input.required, false);
  });

  it('marks itself invalid and is described by its error, which replaces the hint', () => {
    const input = showInput({ error: 'Required', hint: 'Work address' });
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.equal(input.getAttribute('aria-describedby'), 'email-error');
    screen.getByRole('textbox', { name: 'Email', description: 'Required' });
    assert.equal(screen.getByRole('alert').textContent, 'Required');
    assert.ok(!screen.queryByText('Work address'));
  });

  it('is described by its hint when there is no error', () => {
    const input = showInput({ hint: 'Work address' });
    assert.equal(input.getAttribute('aria-describedby'), 'email-hint');
    assert.equal(input.getAttribute('aria-invalid'), null);
    screen.getByRole('textbox', { name: 'Email', description: 'Work address' });
  });

  it('is required with a decorative asterisk kept out of its name', () => {
    const input = showInput({ required: true });
    assert.equal(input.required, true);
    assert.equal(screen.getByText('*').getAttribute('aria-hidden'), 'true');
  });

  it('keeps its name when the label is visually hidden', () => {
    showInput({ isLabelHidden: true });
    assert.ok(screen.getByText('Email').classList.contains('sr-only'));
  });

  it('passes native attributes through to the input', () => {
    render(
      createElement(Input, {
        id: 'q',
        label: 'Search',
        type: 'search',
        placeholder: 'Name or ID',
        readOnly: true,
        defaultValue: 'Doe'
      })
    );
    const input = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search' });
    assert.equal(input.placeholder, 'Name or ID');
    assert.equal(input.readOnly, true);
    assert.equal(input.value, 'Doe');
  });

  it('reports typing through onChange', async () => {
    const Host = () => {
      const [value, setValue] = useState('');
      return createElement(Input, {
        id: 'email',
        label: 'Email',
        value,
        onChange: (e) => setValue(e.target.value)
      });
    };
    render(createElement(Host));
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Email' });
    await userEvent.setup().type(input, 'a@b.co');
    assert.equal(input.value, 'a@b.co');
  });

  it('cannot be typed into when disabled', async () => {
    const input = showInput({ disabled: true });
    await userEvent.setup().type(input, 'x');
    assert.equal(input.disabled, true);
    assert.equal(input.value, '');
  });

  it('is a medium control in body text, switching to monospace on request', () => {
    const classes = showInput().classList;
    assert.ok(classes.contains('h-10'));
    assert.ok(classes.contains('sm:text-sm'));
    assert.ok(!classes.contains('font-mono'));
    render(createElement(Input, { id: 'code', label: 'Code', isMonospace: true }));
    assert.ok(screen.getByRole('textbox', { name: 'Code' }).classList.contains('font-mono'));
  });

  it('shows date placeholders in capitals, as MM/DD/YYYY', () => {
    render(createElement(Input, { id: 'd', label: 'Date', type: 'date' }));
    const input = screen.getByLabelText('Date');
    assert.equal(input.getAttribute('type'), 'date');
    assert.ok(input.classList.contains('[&:is([type=date],[type=datetime-local])]:uppercase'));
  });
});
