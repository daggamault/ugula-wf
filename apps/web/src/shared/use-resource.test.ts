import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useResource } from './use-resource.ts';

describe('useResource', () => {
  it('starts loading without data before effects run', () => {
    const Probe = () => {
      const { data, loading, error } = useResource('k', async () => 'x');
      return createElement('p', null, `${String(data)}|${loading}|${String(error)}`);
    };
    assert.equal(renderToStaticMarkup(createElement(Probe)), '<p>undefined|true|undefined</p>');
  });
});
