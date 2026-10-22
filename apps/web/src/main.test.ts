import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mountApp } from './main.ts';

describe('web mountApp', () => {
  it('throws when root element is missing', () => {
    assert.throws(
      () => mountApp(null, { apiUrl: 'http://localhost:3001' }),
      /Missing root element/
    );
  });
});
