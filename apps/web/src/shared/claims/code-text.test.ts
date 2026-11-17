import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render } from '../testing-dom.ts';
import { CodeLabel, CodeText, coded, codedText, codeOf, shownCode } from './code-text.tsx';

describe('coded', () => {
  it('keeps the description and the code apart', () => {
    assert.deepEqual(coded('Ambulance - Land', '41'), { text: 'Ambulance - Land', code: '41' });
  });

  it('shows the bare code without a description', () => {
    assert.deepEqual(coded(null, '41'), { text: '41', code: null });
    assert.deepEqual(coded('', '41'), { text: '41', code: null });
  });
});

describe('codedText', () => {
  it('writes the code after its description for plain text', () => {
    assert.equal(
      codedText({ text: 'Emergent (Immediate Response)', code: '2223001' }),
      'Emergent (Immediate Response) (2223001)'
    );
    assert.equal(codedText({ text: '41', code: null }), '41');
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

describe('codeOf', () => {
  it('describes a code from the given descriptions', () => {
    assert.deepEqual(codeOf({ icd10cm: { I214: 'NSTEMI' } }, 'icd10cm', 'I214'), {
      text: 'NSTEMI',
      code: 'I21.4'
    });
  });

  it('describes origin and destination modifiers without descriptions', () => {
    assert.deepEqual(codeOf({}, 'modifier', 'RH'), { text: 'Residence to hospital', code: 'RH' });
  });

  it('shows the bare code when it has no description', () => {
    assert.deepEqual(codeOf({ hcpcs: { A0427: 'ALS1' } }, 'hcpcs', 'A0999'), {
      text: 'A0999',
      code: null
    });
  });
});

describe('CodeLabel', () => {
  const show = (value: Parameters<typeof CodeLabel>[0]['value'], isInline = false) =>
    render(createElement(CodeLabel, { value, isInline })).container;

  it('puts the muted code on its own line under the description', () => {
    const label = show({ text: 'Emergent (Immediate Response)', code: '2223001' });
    const [text, code] = label.querySelectorAll('span > span');
    assert.equal(label.firstElementChild?.className, 'flex flex-col gap-0.5');
    assert.equal(text?.textContent, 'Emergent (Immediate Response)');
    assert.equal(code?.textContent, '2223001');
    assert.ok(code?.className.includes('text-surface-fg-muted'));
    assert.equal(label.textContent, 'Emergent (Immediate Response) 2223001');
  });

  it('keeps the muted code on the same line when inline', () => {
    const label = show({ text: 'Residence to hospital', code: 'RH' }, true);
    assert.equal(label.firstElementChild?.className, '');
    assert.equal(label.textContent, 'Residence to hospital RH');
  });

  it('shows a code without a description on its own', () => {
    assert.equal(show({ text: 'A0999', code: null }).innerHTML, '<span>A0999</span>');
  });
});

describe('CodeText', () => {
  it('renders the described code', () => {
    const { container } = render(
      createElement(CodeText, { codes: { hcpcs: { A0427: 'ALS1' } }, set: 'hcpcs', code: 'A0427' })
    );
    assert.equal(container.textContent, 'ALS1 A0427');
  });
});
