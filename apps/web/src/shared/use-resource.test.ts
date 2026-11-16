import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLoadQueue, loadFailure, refreshFailure, useResource } from './use-resource.ts';

describe('useResource', () => {
  it('starts loading without data before effects run', () => {
    const Probe = () => {
      const { data, loading, error } = useResource('k', async () => 'x');
      return createElement('p', null, `${String(data)}|${loading}|${String(error)}`);
    };
    assert.equal(renderToStaticMarkup(createElement(Probe)), '<p>undefined|true|undefined</p>');
  });
});

describe('loadFailure and refreshFailure', () => {
  it('fail the page only for data never loaded, and report a failed refresh inline', () => {
    const lost = new Error('Network down');
    const loaded = { data: 'task', error: lost };
    const fresh = { data: 'claim', error: undefined };
    assert.equal(loadFailure(loaded, fresh), undefined);
    assert.equal(refreshFailure(loaded, fresh), 'Network down');
    assert.equal(loadFailure(fresh, { data: undefined, error: lost }), lost);
    assert.equal(refreshFailure(fresh), '');
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
