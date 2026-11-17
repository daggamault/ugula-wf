import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent } from '../testing-dom.ts';
import { FileButton } from './file-button.tsx';

const show = (props: Partial<Parameters<typeof FileButton>[0]> = {}) => {
  const picks: string[][] = [];
  const { container } = render(
    createElement(FileButton, {
      label: 'Import Files',
      busy: false,
      onFiles: (files) => picks.push(files.map((f) => f.name)),
      ...props
    })
  );
  const input = container.querySelector('input');
  assert.ok(input);
  return {
    picks,
    input,
    button: screen.getByRole('button', { name: props.label ?? 'Import Files' }),
    user: userEvent.setup()
  };
};

const xml = (name: string) => new File(['<x/>'], name, { type: 'text/xml' });

describe('FileButton', () => {
  it('is a button backed by a hidden picker for several files of the accepted types', () => {
    const { input } = show({ accept: '.xml' });
    assert.equal(input.type, 'file');
    assert.equal(input.hidden, true);
    assert.equal(input.multiple, true);
    assert.equal(input.accept, '.xml');
    assert.equal(input.disabled, false);
  });

  it('opens the picker when clicked', async () => {
    const { input, button, user } = show();
    const opened: string[] = [];
    input.addEventListener('click', () => opened.push('picker'));
    await user.click(button);
    assert.deepEqual(opened, ['picker']);
  });

  it('hands over the picked files and clears the picker so the same files can be picked again', async () => {
    const { input, picks, user } = show({ accept: '.xml' });
    await user.upload(input, [xml('a.xml'), xml('b.xml')]);
    assert.deepEqual(picks, [['a.xml', 'b.xml']]);
    assert.equal(input.value, '');
  });

  it('shows progress and blocks new picks while busy', async () => {
    const { input, button, user } = show({ busy: true });
    const opened: string[] = [];
    input.addEventListener('click', () => opened.push('picker'));
    assert.equal(button.getAttribute('aria-busy'), 'true');
    assert.equal(button.getAttribute('aria-disabled'), 'true');
    assert.equal(input.disabled, true);
    await user.click(button);
    assert.deepEqual(opened, []);
  });
});
