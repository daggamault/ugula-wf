import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  agencyHref,
  agencyOfPath,
  agencyPath,
  currentAgency,
  Link,
  matchPath,
  useLocation
} from './router.tsx';

const AGENCY = '0b7e6a52-3c1d-4f8e-9a2b-5d6c7e8f9a0b';

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
