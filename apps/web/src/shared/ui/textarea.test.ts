import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement, useState } from 'react';
import { render, screen, userEvent } from '../testing-dom.ts';
import { Textarea } from './textarea.tsx';

type Props = Parameters<typeof Textarea>[0];

const showTextarea = (props: Partial<Props> = {}) => {
  render(createElement(Textarea, { id: 'note', label: 'Note', ...props }));
  return screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Note' });
};

describe('Textarea', () => {
  it('is a multi-line textbox named by its label, valid and undescribed by default', () => {
    const textarea = showTextarea();
    assert.equal(textarea.tagName, 'TEXTAREA');
    assert.equal(textarea.id, 'note');
    assert.equal(textarea.getAttribute('aria-invalid'), null);
    assert.equal(textarea.getAttribute('aria-describedby'), null);
    assert.equal(textarea.required, false);
  });

  it('is described by its hint', () => {
    const textarea = showTextarea({ hint: 'Any value' });
    assert.equal(textarea.getAttribute('aria-describedby'), 'note-hint');
    screen.getByRole('textbox', { name: 'Note', description: 'Any value' });
  });

  it('marks itself invalid and is described by its error, which replaces the hint', () => {
    const textarea = showTextarea({ error: 'Too long', hint: 'Any value' });
    assert.equal(textarea.getAttribute('aria-invalid'), 'true');
    assert.equal(textarea.getAttribute('aria-describedby'), 'note-error');
    assert.equal(screen.getByRole('alert').textContent, 'Too long');
    assert.ok(!screen.queryByText('Any value'));
  });

  it('is required with a decorative asterisk kept out of its name', () => {
    const textarea = showTextarea({ required: true });
    assert.equal(textarea.required, true);
    assert.equal(screen.getByText('*').getAttribute('aria-hidden'), 'true');
  });

  it('spell checks body text', () => {
    const textarea = showTextarea();
    assert.equal(textarea.getAttribute('spellcheck'), 'true');
    assert.ok(textarea.classList.contains('sm:text-sm'));
    assert.ok(!textarea.classList.contains('font-mono'));
  });

  it('switches to small monospace without spell checking', () => {
    const textarea = showTextarea({ isMonospace: true });
    assert.equal(textarea.getAttribute('spellcheck'), 'false');
    assert.ok(textarea.classList.contains('font-mono'));
    assert.ok(textarea.classList.contains('text-xs'));
    assert.ok(!textarea.classList.contains('sm:text-sm'));
  });

  it('lets a caller override spell checking', () => {
    const textarea = showTextarea({ isMonospace: true, spellCheck: true });
    assert.equal(textarea.getAttribute('spellcheck'), 'true');
  });

  it('reports typing, including new lines, through onChange', async () => {
    const Host = () => {
      const [value, setValue] = useState('');
      return createElement(Textarea, {
        id: 'note',
        label: 'Note',
        value,
        onChange: (e) => setValue(e.target.value)
      });
    };
    render(createElement(Host));
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Note' });
    await userEvent.setup().type(textarea, 'one{Enter}two');
    assert.equal(textarea.value, 'one\ntwo');
  });

  it('cannot be typed into when disabled', async () => {
    const textarea = showTextarea({ disabled: true });
    await userEvent.setup().type(textarea, 'x');
    assert.equal(textarea.value, '');
  });
});
