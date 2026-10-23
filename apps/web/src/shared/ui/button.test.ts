import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, ButtonLink, buttonClasses } from './button.tsx';

describe('Button', () => {
  it('renders a pointer button with semantic intent classes', () => {
    const html = renderToStaticMarkup(createElement(Button, null, 'Save'));
    assert.ok(html.includes('type="button"'));
    assert.ok(html.includes('bg-primary'));
    assert.ok(html.includes('cursor-pointer'));
    assert.ok(!html.includes('w-full'));
    assert.ok(buttonClasses({ intent: 'danger' }).includes('bg-danger'));
    assert.ok(buttonClasses({ variant: 'outline' }).includes('border-border'));
    assert.ok(buttonClasses({ intent: 'danger', variant: 'outline' }).includes('text-danger'));
    assert.ok(buttonClasses({ size: 'sm' }).includes('min-h-8'));
  });

  it('stays focusable when blocked and explains why', () => {
    const html = renderToStaticMarkup(
      createElement(Button, { disabledReason: 'No changes to save.' }, 'Save')
    );
    assert.ok(html.includes('aria-disabled="true"'));
    assert.ok(!html.includes('disabled=""'));
    assert.ok(html.includes('No changes to save.'));
    assert.ok(html.includes('popover="manual"'));
  });

  it('skips the tooltip when nothing blocks it', () => {
    assert.ok(!renderToStaticMarkup(createElement(Button, null, 'Go')).includes('popover'));
  });

  it('shows a pending overlay and supports full width', () => {
    const html = renderToStaticMarkup(
      createElement(Button, { isPending: true, isBlock: true }, 'Go')
    );
    assert.ok(html.includes('aria-busy="true"'));
    assert.ok(html.includes('w-full'));
  });

  it('renders links styled as buttons', () => {
    const html = renderToStaticMarkup(
      createElement(ButtonLink, { to: '/runs', variant: 'outline' }, 'Runs')
    );
    assert.ok(html.includes('href="/runs"'));
    assert.ok(html.includes('border-border'));
  });
});
