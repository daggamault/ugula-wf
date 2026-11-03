import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLoadQueue, useResource } from './use-resource.ts';

describe('useResource', () => {
  it('starts loading without data before effects run', () => {
    const Probe = () => {
      const { data, loading, error } = useResource('k', async () => 'x');
      return createElement('p', null, `${String(data)}|${loading}|${String(error)}`);
    };
    assert.equal(renderToStaticMarkup(createElement(Probe)), '<p>undefined|true|undefined</p>');
  });
});

describe('createLoadQueue', () => {
  it('holds reloads asked for while a load runs and replays them once afterwards', () => {
    const queue = createLoadQueue();
    assert.equal(queue.request(), true);
    queue.start();
    assert.equal(queue.request(), false);
    assert.equal(queue.request(), false);
    assert.equal(queue.finish(), true);
    queue.start();
    assert.equal(queue.finish(), false);
    assert.equal(queue.request(), true);
  });
});
