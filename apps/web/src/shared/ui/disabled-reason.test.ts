import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MouseEvent } from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DisabledReason, preventDisabledClick } from './disabled-reason.tsx';

describe('DisabledReason', () => {
  it('renders a screen reader explanation only when there is a reason', () => {
    assert.equal(
      renderToStaticMarkup(createElement(DisabledReason, { id: 'r', reason: 'Busy' })),
      '<span id="r" class="sr-only">Busy</span>'
    );
    assert.equal(
      renderToStaticMarkup(createElement(DisabledReason, { id: 'r', reason: undefined })),
      ''
    );
  });

  it('cancels clicks on blocked controls', () => {
    let prevented = false;
    preventDisabledClick({ preventDefault: () => (prevented = true) } as unknown as MouseEvent);
    assert.ok(prevented);
  });
});
