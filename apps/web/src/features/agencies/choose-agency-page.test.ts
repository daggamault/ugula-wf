import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChooseAgencyPage } from './choose-agency-page.tsx';

const AGENCY = '0b7e6a52-3c1d-4f8e-9a2b-5d6c7e8f9a0b';

describe('ChooseAgencyPage', () => {
  it('links each agency to its home page', () => {
    const html = renderToStaticMarkup(
      createElement(ChooseAgencyPage, {
        agencies: [
          { id: AGENCY, name: 'North EMS', organizationId: 'o1', organizationName: 'Acme' }
        ],
        home: '/claims',
        onSignOut: () => undefined
      })
    );
    assert.ok(html.includes('Choose an Agency'));
    assert.ok(html.includes(`href="/agencies/${AGENCY}/claims"`));
    assert.ok(html.includes('North EMS') && html.includes('Acme'));
    assert.ok(html.includes('Sign Out'));
    assert.ok(!html.includes('role="alert"') && !html.includes('Ask an administrator'));
  });

  it('explains an empty list and shows why the last agency was refused', () => {
    const html = renderToStaticMarkup(
      createElement(ChooseAgencyPage, {
        agencies: [],
        home: '/claims',
        notice: 'You cannot open that agency. Choose another.',
        onSignOut: () => undefined
      })
    );
    assert.ok(html.includes('Ask an administrator to invite you.'));
    assert.ok(html.includes('You cannot open that agency. Choose another.'));
  });
});
