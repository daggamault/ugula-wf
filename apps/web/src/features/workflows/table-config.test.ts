import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  columnKind,
  columnNameError,
  columnType,
  conditionValue,
  formatCell,
  freeName,
  parseCell,
  readDecision,
  readLookup,
  removeColumn,
  renameColumn,
  takesList,
  takesValue,
  toJson
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

const two = { ...table, inputs: [...table.inputs, { name: 'miles', type: 'number' as const }] };

describe('readDecision', () => {
  it('reads columns, rules and the fallback, skipping malformed rules', () => {
    assert.deepEqual(table, {
      inputs: [{ name: 'care', type: 'string', label: 'Level of care' }],
      outputs: [{ name: 'level', type: 'string' }],
      rules: [
        { label: 'ALS', when: { care: { op: 'is', value: '4232005' } }, set: { level: 'ALS1' } },
        { label: 'Other', when: {}, set: {} }
      ],
      otherwise: { level: 'BLS' },
      otherwiseLabel: ''
    });
  });

  it('fills defaults for missing names, types, labels and conditions', () => {
    assert.deepEqual(
      readDecision({
        inputs: [{}, { name: 'x', label: 3 }],
        rules: [{ when: [], set: 'x' }],
        otherwise: [],
        otherwiseLabel: 'Everything else'
      }),
      {
        inputs: [
          { name: '', type: 'string' },
          { name: 'x', type: 'string' }
        ],
        outputs: [],
        rules: [{ label: '', when: {}, set: {} }],
        otherwise: {},
        otherwiseLabel: 'Everything else'
      }
    );
  });

  it('reads nothing from a missing or non-object config', () => {
    const empty = { inputs: [], outputs: [], rules: [], otherwise: {}, otherwiseLabel: '' };
    assert.deepEqual(readDecision(null), empty);
    assert.deepEqual(readDecision(undefined), empty);
    assert.deepEqual(readDecision([1]), empty);
  });
});

describe('readLookup', () => {
  it('reads rows as text keys, skipping malformed rows', () => {
    assert.deepEqual(
      readLookup({ type: 'number', rows: [{ key: 1, value: 2 }, null, { value: 'x' }, {}] }),
      {
        type: 'number',
        rows: [
          { key: '1', value: 2 },
          { key: '', value: 'x' },
          { key: '', value: null }
        ],
        fallback: null
      }
    );
  });

  it('defaults to text without rows and keeps the fallback', () => {
    assert.deepEqual(readLookup({ fallback: 'none' }), {
      type: 'string',
      rows: [],
      fallback: 'none'
    });
    assert.deepEqual(readLookup(null), { type: 'string', rows: [], fallback: null });
  });
});

describe('parseCell', () => {
  it('reads blank cells as no value', () => {
    assert.equal(parseCell(' ', 'string'), null);
    assert.equal(parseCell('', 'number'), null);
  });

  it('trims text', () => {
    assert.equal(parseCell(' ALS1 ', 'string'), 'ALS1');
  });

  it('reads true or false and nothing else for boolean columns', () => {
    assert.equal(parseCell('true', 'boolean'), true);
    assert.equal(parseCell('false', 'boolean'), false);
    assert.equal(parseCell('maybe', 'boolean'), null);
  });

  it('reads numbers and keeps text that is not one', () => {
    assert.equal(parseCell('2.5', 'number'), 2.5);
    assert.equal(parseCell('3', 'integer'), 3);
    assert.equal(parseCell('lots', 'integer'), 'lots');
    assert.equal(parseCell('Infinity', 'number'), 'Infinity');
  });

  it('keeps a fraction in a whole-number column as text, like any other invalid number', () => {
    assert.equal(parseCell('2.5', 'integer'), '2.5');
    assert.equal(parseCell('-4', 'integer'), -4);
  });

  it('splits list cells on commas, dropping blanks', () => {
    assert.deepEqual(parseCell('09, 06,', { list: 'string' }), ['09', '06']);
  });
});

describe('conditionValue', () => {
  it('reads list operators as lists of text whatever the column type', () => {
    assert.deepEqual(conditionValue('oneOf', '4232003, 4232005', 'string'), ['4232003', '4232005']);
    assert.deepEqual(conditionValue('startsWith', '1, 2', 'integer'), ['1', '2']);
  });

  it('reads other operators by the column type', () => {
    assert.equal(conditionValue('gte', '3', 'integer'), 3);
    assert.equal(conditionValue('is', '3', 'string'), '3');
  });
});

describe('formatCell', () => {
  it('shows values as editable text', () => {
    assert.equal(formatCell(undefined), '');
    assert.equal(formatCell(null), '');
    assert.equal(formatCell(false), 'false');
    assert.equal(formatCell(2.5), '2.5');
    assert.equal(formatCell(['09', '06']), '09, 06');
    assert.equal(formatCell({ a: 1 }), '{"a":1}');
  });
});

describe('operators', () => {
  it('takes a value except for empty and present checks', () => {
    assert.deepEqual((['is', 'oneOf', 'gt', 'empty', 'present'] as const).map(takesValue), [
      true,
      true,
      true,
      false,
      false
    ]);
  });

  it('takes a list for one-of and starts-with checks', () => {
    assert.deepEqual((['oneOf', 'notOneOf', 'startsWith', 'is', 'gte'] as const).map(takesList), [
      true,
      true,
      true,
      false,
      false
    ]);
  });
});

describe('column types', () => {
  it('names the kind of each column type', () => {
    assert.equal(columnKind('integer'), 'integer');
    assert.equal(columnKind({ list: 'string' }), 'list');
  });

  it('turns a kind back into a column type', () => {
    assert.deepEqual(columnType('list'), { list: 'string' });
    assert.equal(columnType('boolean'), 'boolean');
  });
});

describe('columnNameError', () => {
  it('asks for a name', () => {
    assert.equal(columnNameError(two, 'inputs', 'miles', '  '), 'Enter a name.');
  });

  it('refuses a name another column on the same side has', () => {
    assert.equal(
      columnNameError(two, 'inputs', 'miles', ' care '),
      'Another input is already called care.'
    );
    assert.equal(
      columnNameError(two, 'outputs', 'x', 'level'),
      'Another output is already called level.'
    );
    assert.equal(columnNameError(two, 'outputs', 'level', 'care'), undefined);
  });

  it('accepts keeping the same name', () => {
    assert.equal(columnNameError(two, 'inputs', 'miles', 'miles'), undefined);
  });
});

describe('renameColumn', () => {
  it('renames an input in every rule condition', () => {
    const renamed = renameColumn(table, 'inputs', 'care', ' levelOfCare ');
    assert.deepEqual(renamed.inputs, [
      { name: 'levelOfCare', type: 'string', label: 'Level of care' }
    ]);
    assert.deepEqual(
      renamed.rules.map((r) => r.when),
      [{ levelOfCare: { op: 'is', value: '4232005' } }, {}]
    );
    assert.equal(renamed.otherwise, table.otherwise);
  });

  it('renames an output in every rule and the fallback', () => {
    const out = renameColumn(table, 'outputs', 'level', 'code');
    assert.deepEqual(out.outputs, [{ name: 'code', type: 'string' }]);
    assert.deepEqual(out.otherwise, { code: 'BLS' });
    assert.deepEqual(
      out.rules.map((r) => r.set),
      [{ code: 'ALS1' }, {}]
    );
  });

  it('leaves the table untouched for a taken, blank or unchanged name', () => {
    assert.equal(renameColumn(two, 'inputs', 'miles', 'care'), two);
    assert.equal(renameColumn(two, 'inputs', 'miles', '  '), two);
    assert.equal(renameColumn(two, 'inputs', 'miles', ' miles '), two);
  });
});

describe('removeColumn', () => {
  it('drops an input and its conditions, keeping the fallback', () => {
    const noInput = removeColumn(table, 'inputs', 'care');
    assert.deepEqual(
      [noInput.inputs, noInput.rules.map((r) => r.when), noInput.otherwise],
      [[], [{}, {}], { level: 'BLS' }]
    );
  });

  it('drops an output from every rule and the fallback', () => {
    const dropped = removeColumn(table, 'outputs', 'level');
    assert.deepEqual(
      [dropped.outputs, dropped.otherwise, dropped.rules.map((r) => r.set)],
      [[], {}, [{}, {}]]
    );
  });
});

describe('freeName', () => {
  it('numbers new columns after the existing ones, skipping taken names', () => {
    assert.equal(freeName([], 'input'), 'input1');
    assert.equal(freeName(['input1'], 'input'), 'input2');
    assert.equal(freeName(['input2'], 'input'), 'input3');
    assert.equal(freeName(['a', 'input3', 'input4'], 'input'), 'input5');
  });
});

describe('toJson', () => {
  it('passes the config through unchanged', () => {
    assert.equal(toJson(table), table);
  });
});
