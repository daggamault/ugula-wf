import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Button } from './button.tsx';

describe('Button', () => {
  it('renders a button with cursor-pointer and semantic intent classes', () => {
    const el = Button({ intent: 'primary', children: 'Save' });
    assert.equal(el.type, 'button');
    assert.ok(String(el.props.className).includes('cursor-pointer'));
    assert.ok(String(el.props.className).includes('bg-primary-900'));
  });
});
