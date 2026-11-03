import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  columnKind,
  columnNameError,
  columnType,
  conditionValue,
  formatCell,
  freeName,
  moveRule,
  parseCell,
  readDecision,
  readLookup,
  removeColumn,
  renameColumn,
  takesList,
  takesValue
} from './table-config.ts';

const table = readDecision({
  inputs: [{ name: 'care', type: 'string', label: 'Level of care' }],
  outputs: [{ name: 'level', type: 'string' }],
  rules: [
    { label: 'ALS', when: { care: { op: 'is', value: '4232005' } }, set: { level: 'ALS1' } },
    { label: 'Other', when: {}, set: {} },
    'junk'
  ],
  otherwise: { level: 'BLS' }
});

describe('table config', () => {
  it('reads decision and lookup tables, ignoring malformed parts', () => {
    assert.equal(table.rules.length, 2);
    assert.equal(table.inputs[0]?.label, 'Level of care');
    assert.deepEqual(readDecision(null), { inputs: [], outputs: [], rules: [], otherwise: {} });
    assert.deepEqual(readLookup({ rows: [{ key: 1, value: 'x' }, null] }), {
      type: 'string',
      rows: [{ key: '1', value: 'x' }],
      fallback: null
    });
  });

  it('parses and formats cells by column type', () => {
    assert.equal(parseCell(' ', 'string'), null);
    assert.equal(parseCell('true', 'boolean'), true);
    assert.equal(parseCell('maybe', 'boolean'), null);
    assert.equal(parseCell('2.5', 'number'), 2.5);
    assert.equal(parseCell('lots', 'integer'), 'lots');
    assert.equal(parseCell(' ALS1 ', 'string'), 'ALS1');
    assert.equal(formatCell({ a: 1 }), '{"a":1}');
    assert.deepEqual(parseCell('09, 06,', { list: 'string' }), ['09', '06']);
    assert.deepEqual(conditionValue('oneOf', '4232003, 4232005', 'string'), ['4232003', '4232005']);
    assert.equal(conditionValue('gte', '3', 'integer'), 3);
    assert.equal(formatCell(['09', '06']), '09, 06');
    assert.equal(formatCell(false), 'false');
    assert.equal(formatCell(undefined), '');
    assert.equal(columnKind({ list: 'string' }), 'list');
    assert.deepEqual(columnType('list'), { list: 'string' });
    assert.equal(takesValue('present'), false);
  });

  it('renames and removes columns everywhere rules use them', () => {
    const renamed = renameColumn(table, 'inputs', 'care', 'levelOfCare');
    assert.deepEqual(Object.keys(renamed.rules[0]?.when ?? {}), ['levelOfCare']);
    const out = renameColumn(table, 'outputs', 'level', 'code');
    assert.deepEqual(out.otherwise, { code: 'BLS' });
    assert.deepEqual(out.rules[0]?.set, { code: 'ALS1' });
    const two = { ...table, inputs: [...table.inputs, { name: 'miles', type: 'number' as const }] };
    assert.equal(renameColumn(two, 'inputs', 'miles', 'care'), two);
    assert.equal(renameColumn(two, 'inputs', 'miles', '  '), two);
    assert.match(columnNameError(two, 'inputs', 'miles', 'care') ?? '', /already called care/);
    assert.equal(columnNameError(two, 'inputs', 'miles', ''), 'Enter a name.');
    assert.equal(columnNameError(two, 'inputs', 'miles', 'miles'), undefined);
    assert.deepEqual(
      renameColumn(two, 'inputs', 'miles', ' distance ').inputs[1]?.name,
      'distance'
    );
    assert.equal(takesList('oneOf') && !takesList('is'), true);
    const noInput = removeColumn(table, 'inputs', 'care');
    assert.deepEqual(
      [noInput.inputs, noInput.rules[0]?.when, noInput.otherwise],
      [[], {}, { level: 'BLS' }]
    );
    const dropped = removeColumn(table, 'outputs', 'level');
    assert.deepEqual([dropped.outputs, dropped.otherwise, dropped.rules[0]?.set], [[], {}, {}]);
  });

  it('names new columns and reorders rules', () => {
    assert.equal(freeName(['input1'], 'input'), 'input2');
    assert.equal(freeName(['input2'], 'input'), 'input3');
    assert.deepEqual(
      moveRule(table.rules, 1, -1).map((r) => r.label),
      ['Other', 'ALS']
    );
    assert.deepEqual(
      moveRule(table.rules, 0, -1).map((r) => r.label),
      ['ALS', 'Other']
    );
    assert.deepEqual(
      moveRule(table.rules, 1, 1).map((r) => r.label),
      ['ALS', 'Other']
    );
  });
});
