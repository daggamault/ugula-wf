import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { render } from './testing-dom.ts';
import { type UploadScope, useUploadScope } from './use-upload-scope.ts';

const AGENCY = '0b7e6a52-3c1d-4f8e-9a2b-5d6c7e8f9a0b';

describe('useUploadScope', () => {
  it('is stopped until the component mounts', () => {
    const Probe = () => {
      const scope = useUploadScope()();
      return createElement('p', null, `${scope.agencyId}|${scope.signal.aborted}`);
    };
    assert.equal(renderToStaticMarkup(createElement(Probe)), '<p>null|true</p>');
  });

  it('scopes an upload to the open agency and cancels it when the component goes away', () => {
    window.history.replaceState(null, '', `/agencies/${AGENCY}/imports`);
    let scopeOf: () => UploadScope = () => {
      throw new Error('not rendered');
    };
    const Probe = () => {
      scopeOf = useUploadScope();
      return null;
    };
    const { unmount } = render(createElement(Probe));
    const scope = scopeOf();
    assert.equal(scope.agencyId, AGENCY);
    assert.equal(scope.signal.aborted, false);
    unmount();
    assert.equal(scope.signal.aborted, true);
  });
});
