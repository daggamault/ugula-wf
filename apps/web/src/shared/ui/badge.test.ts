import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Badge } from './badge.tsx';

describe('Badge', () => {
  it('renders a span with semantic intent classes', () => {
    const el = Badge({ intent: 'success', children: 'Healthy' });
    assert.equal(el.type, 'span');
    const classes = String(el.props.className);
    assert.ok(classes.includes('text-success'));
    assert.ok(classes.includes('bg-success/10') && classes.includes('border-success/30'));
    assert.ok(classes.includes('rounded-full') && classes.includes('text-xs/5'));
    assert.ok(classes.includes('items-center'));
  });

  it('falls back to a neutral badge without an intent', () => {
    assert.ok(
      String(Badge({ children: 'Default' }).props.className).includes('text-surface-fg-muted')
    );
  });
});
