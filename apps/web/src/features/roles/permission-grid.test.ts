import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PERMISSION_RESOURCES } from '@ugula/access';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PermissionGrant } from './client.ts';
import { PermissionGrid, RESOURCE_LABELS, toggled } from './permission-grid.tsx';

const grants: PermissionGrant[] = [
  { permission: 'claims:read', description: 'See claims.', isGrantable: true },
  { permission: 'claims:update', description: 'Change claims.', isGrantable: false },
  { permission: 'users:read', description: 'See users.', isGrantable: true }
];

describe('toggled', () => {
  it('adds a permission in sorted order or takes it away', () => {
    assert.deepEqual(toggled(['users:read'], 'claims:read'), ['claims:read', 'users:read']);
    assert.deepEqual(toggled(['claims:read', 'users:read'], 'claims:read'), ['users:read']);
  });
});

describe('PermissionGrid', () => {
  it('shows one row per area and a column per action in use', () => {
    const html = renderToStaticMarkup(
      createElement(PermissionGrid, { grants, selected: ['claims:read'] })
    );
    assert.equal(html.split('scope="row"').length, PERMISSION_RESOURCES.length + 1);
    assert.ok(html.includes('>View<') && html.includes('>Change<'));
    assert.ok(!html.includes('>Create<') && !html.includes('>Delete<'));
    assert.match(html, /aria-label="View Claims" title="See claims."[^>]*checked=""/);
    assert.doesNotMatch(html, /aria-label="View Users"[^>]*checked=""/);
  });

  it('locks permissions the user cannot grant and explains why', () => {
    const html = renderToStaticMarkup(createElement(PermissionGrid, { grants, selected: [] }));
    assert.match(html, /aria-label="Change Claims"[^>]*disabled=""/);
    assert.ok(html.includes('You can&#x27;t grant permissions you don&#x27;t hold.'));
    const readOnly = renderToStaticMarkup(
      createElement(PermissionGrid, { grants, selected: [], readOnly: true })
    );
    assert.match(readOnly, /aria-label="View Claims"[^>]*disabled=""/);
    assert.ok(!readOnly.includes('You can&#x27;t grant'));
  });

  it('labels every resource', () => {
    for (const r of PERMISSION_RESOURCES) assert.ok(RESOURCE_LABELS[r]);
  });
});
