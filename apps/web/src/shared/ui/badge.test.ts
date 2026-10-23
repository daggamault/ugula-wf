import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Badge } from './badge.tsx';

describe('Badge', () => {
  it('renders a span with semantic tone classes', () => {
    const el = Badge({ tone: 'success', children: 'Healthy' });
    assert.equal(el.type, 'span');
    assert.ok(String(el.props.className).includes('text-success'));
    assert.ok(String(Badge({ children: 'Info' }).props.className).includes('text-primary'));
  });
});
