import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CodeText } from './code-text.tsx';

describe('CodeText', () => {
  it('shows a code with its description, dotting ICD-10 codes', () => {
    const html = renderToStaticMarkup(
      createElement(CodeText, {
        codes: { icd10cm: { I214: 'NSTEMI' } },
        set: 'icd10cm',
        code: 'I214'
      })
    );
    assert.ok(html.includes('I21.4') && html.includes('NSTEMI'));
  });

  it('shows the bare code when it has no description', () => {
    const html = renderToStaticMarkup(
      createElement(CodeText, { codes: {}, set: 'hcpcs', code: 'A0999' })
    );
    assert.ok(html.includes('A0999') && !html.includes('text-xs'));
  });
});
