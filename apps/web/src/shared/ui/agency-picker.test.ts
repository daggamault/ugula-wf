import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Agency } from '../access.tsx';
import { AgencyPicker } from './agency-picker.tsx';

const agency = (i: number): Agency => ({
  id: `a${i}`,
  name: `Agency ${i}`,
  organizationId: 'o1',
  organizationName: 'Acme'
});

const render = (agencies: Agency[]) =>
  renderToStaticMarkup(
    createElement(AgencyPicker, {
      agencies,
      current: { id: 'a1', name: 'Agency 1', organizationName: 'Acme' }
    })
  );

describe('AgencyPicker', () => {
  it('shows the current agency and lists the others to switch to', () => {
    const html = render([agency(1), agency(2)]);
    assert.ok(html.includes('Switch agency') && html.includes('Acme'));
    assert.ok(!html.includes('disabled=""'));
    assert.ok(html.includes('aria-label="Agencies"'));
    assert.equal(html.split('aria-current="true"').length, 2);
    assert.ok(html.includes('Agency 2'));
    assert.ok(!html.includes('Find an'));
    assert.ok(html.includes('h-10') && !html.includes('h-12'));
  });

  it('locks the button when there is nowhere to switch to', () => {
    const html = render([agency(1)]);
    assert.ok(html.includes('disabled=""'));
  });

  it('offers a search once the list gets long', () => {
    const html = render([1, 2, 3, 4, 5, 6, 7].map(agency));
    assert.ok(html.includes('>Find an Agency</label>') && html.includes('type="search"'));
    assert.ok(html.includes('placeholder="Find an agency"'));
    assert.ok(html.includes('Agency 7'));
  });
});
