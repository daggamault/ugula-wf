import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render } from '../testing-dom.ts';
import { CodeText, codeText, described, shownCode } from './code-text.tsx';

describe('described', () => {
  it('writes a code after its description', () => {
    assert.equal(described('Ambulance - Land', '41'), 'Ambulance - Land (41)');
  });

  it('writes the bare code without a description', () => {
    assert.equal(described(null, '41'), '41');
    assert.equal(described('', '41'), '41');
  });
});

describe('shownCode', () => {
  it('dots ICD-10 codes', () => {
    assert.equal(shownCode('icd10cm', 'I214'), 'I21.4');
  });

  it('keeps other codes as they are', () => {
    assert.equal(shownCode('hcpcs', 'A0427'), 'A0427');
  });
});

describe('codeText', () => {
  it('describes a code from the given descriptions', () => {
    assert.equal(codeText({ icd10cm: { I214: 'NSTEMI' } }, 'icd10cm', 'I214'), 'NSTEMI (I21.4)');
  });

  it('describes origin and destination modifiers without descriptions', () => {
    assert.equal(codeText({}, 'modifier', 'RH'), 'Residence to hospital (RH)');
  });

  it('writes the bare code when it has no description', () => {
    assert.equal(codeText({}, 'hcpcs', 'A0999'), 'A0999');
    assert.equal(codeText({ hcpcs: { A0427: 'ALS1' } }, 'hcpcs', 'A0999'), 'A0999');
  });
});

describe('CodeText', () => {
  it('renders the described code as text', () => {
    const { container } = render(
      createElement(CodeText, { codes: { hcpcs: { A0427: 'ALS1' } }, set: 'hcpcs', code: 'A0427' })
    );
    assert.equal(container.innerHTML, '<span>ALS1 (A0427)</span>');
  });
});
