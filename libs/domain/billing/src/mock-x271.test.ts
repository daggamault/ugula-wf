import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build271 } from './mock-x271.ts';
import { readX12 } from './x12.ts';

const at = { createdAt: new Date('2026-11-03T12:00:00Z'), controlNumber: 7 };

const isaOf = (text: string) => readX12(text).segments[0] ?? [];

describe('build271', () => {
  it('builds a 271 and a well-formed envelope', () => {
    const text = build271({ trace: 'T-1', active: true }, { ...at, sender: 'CH', receiver: 'ME' });
    const file = readX12(text);
    assert.equal(file.kind, '271');
    assert.equal(file.controlNumber, '000000007');
    const isa = isaOf(text);
    assert.equal(`${isa.join('*')}~`.length, 106);
    assert.equal(isa[6]?.trim(), 'CH');
    assert.equal(isa[8]?.trim(), 'ME');
    const se = file.segments.find((s) => s[0] === 'SE');
    const st = file.segments.findIndex((s) => s[0] === 'ST');
    const seAt = file.segments.findIndex((s) => s[0] === 'SE');
    assert.equal(se?.[1], String(seAt - st + 1));
    assert.deepEqual(file.segments.at(-2), ['GE', '1', '7']);
  });
});
