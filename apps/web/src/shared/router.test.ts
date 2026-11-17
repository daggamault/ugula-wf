import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement, type MouseEvent } from 'react';
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
  usePendingLeave,
  useUnsavedChanges
} from './router.tsx';
import { act, render, screen, userEvent } from './testing-dom.ts';

const AGENCY = '0b7e6a52-3c1d-4f8e-9a2b-5d6c7e8f9a0b';

const at = () => `${window.location.pathname}${window.location.search}`;

const pop = (href: string) =>
  act(() => {
    window.history.pushState(null, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

const unload = () => {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
};

const Where = () => {
  const { path, query, agencyId } = useLocation();
  return createElement('output', null, `${path}|${query}|${agencyId ?? ''}`);
};

const Pending = () => createElement('p', null, usePendingLeave() ?? 'none');

describe('matchPath', () => {
  it('matches patterns and decodes params', () => {
    assert.deepEqual(matchPath('/runs/:id', '/runs/a%20b'), { id: 'a b' });
    assert.deepEqual(matchPath('/runs', '/runs/'), {});
    assert.equal(matchPath('/runs/:id', '/runs'), null);
    assert.equal(matchPath('/runs/:id', '/tasks/1'), null);
    assert.equal(matchPath('/claims/:id', '/claims/%E0'), null);
  });
});

describe('agency paths', () => {
  it('reads the agency id from the start of a path', () => {
    assert.equal(agencyOfPath(`/agencies/${AGENCY}/claims`), AGENCY);
    assert.equal(agencyOfPath(`/agencies/${AGENCY}`), AGENCY);
    assert.equal(agencyOfPath(`/agencies/${AGENCY}x/claims`), null);
    assert.equal(agencyOfPath('/agencies/not-a-uuid/claims'), null);
    assert.equal(agencyOfPath('/claims'), null);
  });

  it('reads the agency of the open page', () => {
    assert.equal(currentAgency(), null);
    window.history.replaceState(null, '', `/agencies/${AGENCY}/claims`);
    assert.equal(currentAgency(), AGENCY);
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
});

describe('useLocation', () => {
  it('reads the server-side fallback location, without the agency', () => {
    const Probe = ({ href }: { href: string }) => {
      const { path, query, agencyId } = useLocation(href);
      return createElement('p', null, `${path}|${query.get('q') ?? ''}|${agencyId ?? ''}`);
    };
    const from = (href: string) => renderToStaticMarkup(createElement(Probe, { href }));
    assert.equal(from(`/agencies/${AGENCY}/runs?q=1`), `<p>/runs|1|${AGENCY}</p>`);
    assert.equal(from(`/agencies/${AGENCY}`), `<p>/||${AGENCY}</p>`);
    assert.equal(from('/runs'), '<p>/runs||</p>');
  });

  it('follows navigation and the browser back button', async () => {
    window.history.replaceState(null, '', `/agencies/${AGENCY}/claims`);
    render(createElement(Where));
    const shown = () => screen.getByRole('status').textContent;
    assert.equal(shown(), `/claims||${AGENCY}`);
    act(() => navigate('/runs?status=faulted'));
    assert.equal(at(), `/agencies/${AGENCY}/runs?status=faulted`);
    assert.equal(shown(), `/runs|status=faulted|${AGENCY}`);
    act(() => navigate('/tasks', { replace: true }));
    assert.equal(shown(), `/tasks||${AGENCY}`);
    await pop('/claims');
    assert.equal(shown(), '/claims||');
  });
});

describe('Link', () => {
  it('links within the open agency and navigates without reloading the page', async () => {
    window.history.replaceState(null, '', `/agencies/${AGENCY}/claims`);
    render(
      createElement(
        'div',
        null,
        createElement(Link, { to: '/fees?page=2' }, 'Fees'),
        createElement(Where)
      )
    );
    const link = screen.getByRole('link', { name: 'Fees' });
    assert.equal(link.getAttribute('href'), `/agencies/${AGENCY}/fees?page=2`);
    await userEvent.setup().click(link);
    assert.equal(at(), `/agencies/${AGENCY}/fees?page=2`);
    assert.equal(screen.getByRole('status').textContent, `/fees|page=2|${AGENCY}`);
  });

  it('leaves modified clicks and handled clicks to the browser', async () => {
    window.history.replaceState(null, '', '/claims');
    const clicks: string[] = [];
    render(
      createElement(
        'div',
        null,
        createElement(Link, { to: '/fees' }, 'Fees'),
        createElement(
          Link,
          {
            to: '/payers',
            onClick: (e: MouseEvent<HTMLAnchorElement>) => {
              clicks.push('payers');
              e.preventDefault();
            }
          },
          'Payers'
        )
      )
    );
    const leftToBrowser: boolean[] = [];
    const browser = (e: Event) => {
      leftToBrowser.push(!e.defaultPrevented);
      e.preventDefault();
    };
    window.addEventListener('click', browser);
    const user = userEvent.setup();
    await user.keyboard('{Control>}');
    await user.click(screen.getByRole('link', { name: 'Fees' }));
    await user.keyboard('{/Control}');
    await user.click(screen.getByRole('link', { name: 'Payers' }));
    await user.click(screen.getByRole('link', { name: 'Fees' }));
    window.removeEventListener('click', browser);
    assert.deepEqual(leftToBrowser, [true, false, false]);
    assert.deepEqual(clicks, ['payers']);
    assert.equal(at(), '/fees');
  });
});

describe('unsaved changes guard', () => {
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

  it('puts the user back when they go back or forward from unsaved changes', async () => {
    navigate('/fees/f1');
    const release = guardChanges([]);
    await pop('/fees');
    assert.equal(at(), '/fees/f1');
    discard();
    assert.equal(at(), '/fees');
    release();
    await pop('/runs');
    assert.equal(at(), '/runs');
  });

  it('asks the browser to confirm a reload or close only while guarded', () => {
    assert.equal(unload(), false);
    const release = guardChanges([]);
    assert.equal(unload(), true);
    release();
    assert.equal(unload(), false);
  });

  it('shows the held destination until the user stays', () => {
    navigate('/fees/f1');
    const release = guardChanges([]);
    render(createElement(Pending));
    screen.getByText('none');
    act(() => navigate('/payers'));
    screen.getByText('/payers');
    act(() => stay());
    screen.getByText('none');
    assert.equal(at(), '/fees/f1');
    release();
  });

  it('guards only while the page has unsaved changes', () => {
    navigate('/fees/f1');
    const Editor = ({ dirty }: { dirty: boolean }) => {
      useUnsavedChanges(dirty);
      return null;
    };
    const { rerender, unmount } = render(createElement(Editor, { dirty: false }));
    assert.equal(unload(), false);
    rerender(createElement(Editor, { dirty: true }));
    assert.equal(unload(), true);
    navigate('/fees');
    assert.equal(at(), '/fees/f1');
    stay();
    rerender(createElement(Editor, { dirty: false }));
    assert.equal(unload(), false);
    rerender(createElement(Editor, { dirty: true }));
    unmount();
    assert.equal(unload(), false);
  });

  it('has nothing pending when rendered on the server', () => {
    assert.equal(renderToStaticMarkup(createElement(Pending)), '<p>none</p>');
  });
});
