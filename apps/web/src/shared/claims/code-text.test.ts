import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CodeText, codeText } from './code-text.tsx';

describe('codeText', () => {
  it('writes a code after its description, dotting ICD-10 codes', () => {
    assert.equal(codeText({ icd10cm: { I214: 'NSTEMI' } }, 'icd10cm', 'I214'), 'NSTEMI (I21.4)');
    assert.equal(codeText({}, 'modifier', 'RH'), 'Residence to hospital (RH)');
  });

  it('writes the bare code when it has no description', () => {
    assert.equal(codeText({}, 'hcpcs', 'A0999'), 'A0999');
    assert.equal(
      renderToStaticMarkup(createElement(CodeText, { codes: {}, set: 'hcpcs', code: 'A0999' })),
      '<span>A0999</span>'
    );
  });
});
