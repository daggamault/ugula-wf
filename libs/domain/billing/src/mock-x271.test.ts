import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build271 } from './mock-x271.ts';
import { readX12 } from './x12.ts';
import { read271 } from './x271.ts';

const at = { createdAt: new Date('2026-11-03T12:00:00Z'), controlNumber: 7 };

const isaOf = (text: string) => readX12(text).segments[0] ?? [];

const segmentsOf = (text: string, ids: string[]) =>
  readX12(text).segments.filter((s) => ids.includes(s[0] ?? ''));

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

  it('answers active Part B coverage for the default payer, provider and member', () => {
    const text = build271({ trace: 'T-1', active: true }, at);
    assert.deepEqual(segmentsOf(text, ['NM1', 'EB']), [
      ['NM1', 'PR', '2', 'MEDICARE', '', '', '', '', 'PI', 'DEMOMCR'],
      ['NM1', '1P', '2', 'DEVELOPMENT EMS', '', '', '', '', 'XX', '1234567893'],
      ['NM1', 'IL', '1', 'KLINE', 'DOROTHY', '', '', '', 'MI', '2KT7XM4RW91'],
      ['EB', '1', '', '30', '', 'MEDICARE PART B']
    ]);
    assert.deepEqual(read271(text), [
      {
        trace: 'T-1',
        active: true,
        planName: 'MEDICARE PART B',
        coverageStart: null,
        coverageEnd: null,
        advantagePlan: null,
        stay: null,
        messages: []
      }
    ]);
  });

  it('answers inactive coverage with a message, a facility stay and an Advantage plan', () => {
    const text = build271(
      {
        trace: 'T-2',
        active: false,
        payer: { name: 'Medicare', id: 'MCR' },
        provider: { name: 'Metro EMS', id: '1111111112' },
        subscriber: { lastName: 'Doe', memberId: 'M1' },
        message: 'COVERAGE TERMINATED',
        stay: { kind: 'snf', admittedOn: '2026-10-01' },
        advantagePlan: { name: 'Sunshine Advantage', id: 'H1' }
      },
      at
    );
    assert.deepEqual(segmentsOf(text, ['NM1', 'EB', 'MSG', 'DTP', 'LS', 'LE']), [
      ['NM1', 'PR', '2', 'MEDICARE', '', '', '', '', 'PI', 'MCR'],
      ['NM1', '1P', '2', 'METRO EMS', '', '', '', '', 'XX', '1111111112'],
      ['NM1', 'IL', '1', 'DOE', '', '', '', '', 'MI', 'M1'],
      ['EB', '6', '', '30'],
      ['MSG', 'COVERAGE TERMINATED'],
      ['EB', 'X', '', 'AG'],
      ['DTP', '435', 'D8', '20261001'],
      ['EB', 'R', '', '30', 'HN'],
      ['LS', '2120'],
      ['NM1', 'PRP', '2', 'SUNSHINE ADVANTAGE', '', '', '', '', 'PI', 'H1'],
      ['LE', '2120']
    ]);
    assert.deepEqual(read271(text)[0]?.stay, {
      kind: 'snf',
      admittedOn: '2026-10-01',
      dischargedOn: null
    });
  });
});
