import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useUploadScope } from './use-upload-scope.ts';

describe('useUploadScope', () => {
  it('is stopped until the component mounts', () => {
    const Probe = () => {
      const scope = useUploadScope()();
      return createElement('p', null, `${scope.agencyId}|${scope.signal.aborted}`);
    };
    assert.equal(renderToStaticMarkup(createElement(Probe)), '<p>null|true</p>');
  });
});
