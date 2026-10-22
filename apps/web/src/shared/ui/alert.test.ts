import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Alert } from './alert.tsx';

describe('Alert', () => {
  it('renders an alert paragraph with semantic intent', () => {
    const el = Alert({ intent: 'danger', children: 'Invalid credentials' });
    assert.equal(el.type, 'p');
    assert.equal(el.props.role, 'alert');
    assert.ok(String(el.props.className).includes('text-danger-700'));
  });
});
