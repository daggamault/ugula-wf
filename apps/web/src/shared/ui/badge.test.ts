import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen } from '../testing-dom.ts';
import { Badge } from './badge.tsx';

const badgeClasses = (props: Parameters<typeof Badge>[0]) => {
  render(createElement(Badge, props));
  const badge = screen.getByText(String(props.children));
  assert.equal(badge.tagName, 'SPAN');
  return [...badge.classList];
};

const tinted = (classes: string[]) =>
  classes.filter((c) => /^(text|bg|border)-(?!xs)/.test(c)).sort();

describe('Badge', () => {
  it('tints border, background and text by intent', () => {
    assert.deepEqual(tinted(badgeClasses({ intent: 'success', children: 'Healthy' })), [
      'bg-success/10',
      'border-success/30',
      'text-success'
    ]);
  });

  it('uses the readable warning text color', () => {
    assert.deepEqual(tinted(badgeClasses({ intent: 'warning', children: 'Late' })), [
      'bg-warning/10',
      'border-warning/30',
      'text-warning-text'
    ]);
  });

  it('marks customized things with the custom accent', () => {
    assert.deepEqual(tinted(badgeClasses({ intent: 'custom', children: 'Custom' })), [
      'bg-custom/10',
      'border-custom/30',
      'text-custom'
    ]);
  });

  it('falls back to a neutral badge without an intent', () => {
    assert.deepEqual(tinted(badgeClasses({ children: 'Default' })), [
      'bg-surface-fg/6',
      'border-border',
      'text-surface-fg-muted'
    ]);
  });
});
