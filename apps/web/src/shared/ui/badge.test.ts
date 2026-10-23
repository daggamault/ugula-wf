import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Badge } from './badge.tsx';

describe('Badge', () => {
  it('renders a span with semantic intent classes', () => {
    const el = Badge({ intent: 'success', children: 'Healthy' });
    assert.equal(el.type, 'span');
    assert.ok(String(el.props.className).includes('text-success'));
  });

  it('falls back to a neutral badge without an intent', () => {
    assert.ok(
      String(Badge({ children: 'Default' }).props.className).includes('text-surface-fg-muted')
    );
  });
});
