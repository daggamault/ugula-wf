import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CopyBadge, RoleBadge, ScopeBadge, StaleBadge, scopeLabel } from './scope-badges.tsx';

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('scope badges', () => {
  it('names each scope and marks copies with the custom accent', () => {
    assert.equal(scopeLabel('system'), 'Built-in');
    const builtIn = html(createElement(ScopeBadge, { scope: 'system' }));
    assert.ok(builtIn.includes('Built-in') && !builtIn.includes('text-custom'));
    const agency = html(createElement(ScopeBadge, { scope: 'agency' }));
    assert.ok(agency.includes('Agency') && agency.includes('text-custom'));
  });

  it('shows agency rules, copies in effect and stale copies', () => {
    assert.ok(html(createElement(RoleBadge, { role: 'slot' })).includes('Agency Rule'));
    assert.equal(html(createElement(RoleBadge, { role: 'rule' })), '');
    assert.ok(
      html(createElement(CopyBadge, { scope: 'system', effective: 'agency' })).includes(
        'Has Agency Copy'
      )
    );
    assert.ok(
      html(createElement(CopyBadge, { scope: 'system', effective: 'organization' })).includes(
        'Has Organization Copy'
      )
    );
    assert.equal(html(createElement(CopyBadge, { scope: 'agency', effective: 'agency' })), '');
    assert.ok(html(createElement(StaleBadge, { stale: true })).includes('Base Updated'));
    assert.equal(html(createElement(StaleBadge, { stale: false })), '');
  });
});
