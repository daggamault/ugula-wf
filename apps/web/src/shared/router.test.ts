import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  agencyHref,
  agencyOfPath,
  agencyPath,
  currentAgency,
  discard,
  guardChanges,
  Link,
  matchPath,
  navigate,
  stay,
  useLocation,
  usePendingLeave
} from './router.tsx';

const AGENCY = '0b7e6a52-3c1d-4f8e-9a2b-5d6c7e8f9a0b';

describe('router', () => {
  it('matches patterns and decodes params', () => {
    assert.deepEqual(matchPath('/runs/:id', '/runs/a%20b'), { id: 'a b' });
    assert.deepEqual(matchPath('/runs', '/runs/'), {});
    assert.equal(matchPath('/runs/:id', '/runs'), null);
    assert.equal(matchPath('/runs/:id', '/tasks/1'), null);
    assert.equal(matchPath('/claims/:id', '/claims/%E0'), null);
  });

  it('renders links and reads the server-side fallback location', () => {
    const Probe = () => {
      const { path, query } = useLocation('/runs?status=faulted');
      return createElement(Link, { to: path }, query.get('status'));
    };
    assert.equal(renderToStaticMarkup(createElement(Probe)), '<a href="/runs">faulted</a>');
  });
});

describe('agency paths', () => {
  it('reads the agency id from the start of a path', () => {
    assert.equal(agencyOfPath(`/agencies/${AGENCY}/claims`), AGENCY);
    assert.equal(agencyOfPath(`/agencies/${AGENCY}`), AGENCY);
    assert.equal(agencyOfPath(`/agencies/${AGENCY}x/claims`), null);
    assert.equal(agencyOfPath('/agencies/not-a-uuid/claims'), null);
    assert.equal(agencyOfPath('/claims'), null);
    assert.equal(currentAgency(), null);
  });

  it('builds agency paths and prefixes app links with the agency', () => {
    assert.equal(agencyPath(AGENCY), `/agencies/${AGENCY}`);
    assert.equal(agencyPath(AGENCY, '/runs?x=1'), `/agencies/${AGENCY}/runs?x=1`);
    assert.equal(agencyHref('/runs', AGENCY), `/agencies/${AGENCY}/runs`);
    assert.equal(agencyHref('/agencies/other/runs', AGENCY), '/agencies/other/runs');
    assert.equal(agencyHref('https://x.test', AGENCY), 'https://x.test');
    assert.equal(agencyHref('/runs', null), '/runs');
    assert.equal(agencyHref('/runs'), '/runs');
  });

  it('strips the agency from the location and reports it', () => {
    const Probe = ({ at }: { at: string }) => {
      const { path, query, agencyId } = useLocation(at);
      return createElement('p', null, `${path}|${query.get('q') ?? ''}|${agencyId ?? ''}`);
    };
    const at = (href: string) => renderToStaticMarkup(createElement(Probe, { at: href }));
    assert.equal(at(`/agencies/${AGENCY}/runs?q=1`), `<p>/runs|1|${AGENCY}</p>`);
    assert.equal(at(`/agencies/${AGENCY}`), `<p>/||${AGENCY}</p>`);
    assert.equal(at('/runs'), '<p>/runs||</p>');
  });
});

const fakeWindow = () => {
  const events = new EventTarget();
  const location = new URL('http://local/');
  const pushed: string[] = [];
  const go = (href: string) => {
    location.href = new URL(href, location).href;
  };
  return {
    location,
    pushed,
    pop: (href: string) => {
      go(href);
      events.dispatchEvent(new Event('popstate'));
    },
    unload: () => {
      const e = new Event('beforeunload', { cancelable: true });
      events.dispatchEvent(e);
      return e.defaultPrevented;
    },
    history: {
      pushState: (_: unknown, __: string, href: string) => {
        pushed.push(href);
        go(href);
      },
      replaceState: (_: unknown, __: string, href: string) => go(href)
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events)
  };
};

describe('unsaved changes guard', () => {
  const win = fakeWindow();
  const at = () => `${win.location.pathname}${win.location.search}`;
  const Pending = () => createElement('p', null, usePendingLeave() ?? 'none');
  before(() => Object.assign(globalThis, { window: win }));
  after(() => Reflect.deleteProperty(globalThis, 'window'));

  it('holds a navigation to another page until the changes are discarded', () => {
    navigate('/fees/f1');
    const release = guardChanges([]);
    navigate('/fees');
    assert.equal(at(), '/fees/f1');
    navigate('/fees/f1?panel=x', { replace: true });
    assert.equal(at(), '/fees/f1?panel=x');
    navigate('/fees');
    discard();
    assert.equal(at(), '/fees');
    navigate('/runs', { force: true });
    assert.equal(at(), '/runs');
    release();
    navigate('/tasks');
    assert.equal(at(), '/tasks');
  });

  it('lets the user stay and treats guarded query params as leaving', () => {
    navigate('/workflows/g1?version=1');
    const release = guardChanges(['version']);
    navigate('/workflows/g1?version=2');
    assert.equal(at(), '/workflows/g1?version=1');
    stay();
    discard();
    assert.equal(at(), '/workflows/g1?version=1');
    release();
  });

  it('puts the user back when they go back or forward from unsaved changes', () => {
    navigate('/fees/f1');
    const release = guardChanges([]);
    win.pop('/fees');
    assert.equal(at(), '/fees/f1');
    assert.equal(win.pushed.at(-1), '/fees/f1');
    discard();
    assert.equal(at(), '/fees');
    release();
    win.pop('/runs');
    assert.equal(at(), '/runs');
  });

  it('asks the browser to confirm a reload or close only while guarded', () => {
    assert.equal(win.unload(), false);
    const release = guardChanges([]);
    assert.equal(win.unload(), true);
    release();
    assert.equal(win.unload(), false);
  });

  it('has nothing pending when rendered on the server', () => {
    assert.equal(renderToStaticMarkup(createElement(Pending)), '<p>none</p>');
  });
});
