import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HealthStatus } from './health-status.tsx';

describe('HealthStatus', () => {
  it('renders success intent when online and danger when offline', () => {
    const up = HealthStatus({ online: true });
    assert.equal(up.props.intent, 'success');
    assert.equal(up.props.children, 'Online');

    const down = HealthStatus({ online: false });
    assert.equal(down.props.intent, 'danger');
    assert.equal(down.props.children, 'Offline');
  });
});
