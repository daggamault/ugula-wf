import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Link, matchPath, useLocation } from './router.tsx';

describe('router', () => {
  it('matches patterns and decodes params', () => {
    assert.deepEqual(matchPath('/runs/:id', '/runs/a%20b'), { id: 'a b' });
    assert.deepEqual(matchPath('/runs', '/runs/'), {});
    assert.equal(matchPath('/runs/:id', '/runs'), null);
    assert.equal(matchPath('/runs/:id', '/tasks/1'), null);
  });

  it('renders links and reads the server-side fallback location', () => {
    const Probe = () => {
      const { path, query } = useLocation('/runs?status=faulted');
      return createElement(Link, { to: path }, query.get('status'));
    };
    assert.equal(renderToStaticMarkup(createElement(Probe)), '<a href="/runs">faulted</a>');
  });
});
