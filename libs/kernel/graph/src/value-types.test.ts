import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ValueType } from './types.ts';
import {
  checkValue,
  fieldPaths,
  fieldType,
  formatType,
  isAssignable,
  isFileType,
  isTextType,
  mergeKinds,
  parseType,
  STD_KINDS,
  unknownKinds
} from './value-types.ts';

describe('value types', () => {
  it('formats nested types', () => {
    assert.equal(
      formatType({ list: { object: { code: 'string' } } }),
      'list<object{code: string}>'
    );
  });

  it('parses the formatted notation back into types', () => {
    for (const type of [
      'number',
      { list: 'string' },
      { object: {} },
      { list: { object: { code: 'string', units: { list: 'integer' } } } }
    ] as const) {
      assert.deepEqual(parseType(formatType(type)), type);
    }
    assert.deepEqual(parseType(' list< number > '), { list: 'number' });
    assert.throws(() => parseType('money'), /Unknown type "money"/);
    assert.throws(() => parseType('list<number'), /Expected ">"/);
    assert.throws(() => parseType('number>'), /Unexpected/);
    assert.deepEqual(parseType('object'), { object: {} });
    assert.throws(() => parseType('object{a string}'), /Expected ":"/);
    assert.throws(() => parseType('list<>'), /Expected a name/);
  });

  it('decides pin compatibility', () => {
    assert.equal(isAssignable('any', 'number'), true);
    assert.equal(isAssignable('integer', 'number'), true);
    assert.equal(isAssignable('datetime', 'string'), true);
    assert.equal(isAssignable('string', 'number'), false);
    assert.equal(isAssignable({ list: 'integer' }, { list: 'number' }), true);
    assert.equal(isAssignable({ list: 'string' }, 'string'), false);
    assert.equal(isAssignable({ object: {} }, { object: { id: 'string' } }), false);
    assert.equal(isAssignable({ object: { id: 'number' } }, { object: { id: 'string' } }), false);
    assert.equal(isAssignable('number', 'integer'), true);
    assert.equal(isAssignable({ list: 'string' }, 'any'), true);
    assert.equal(isAssignable({ list: 'string' }, { object: {} }), false);
  });

  it('parses and formats identity and code kinds', () => {
    for (const type of [
      { id: 'patient' },
      { code: 'hcpcs' },
      { list: { code: 'icd10' } },
      { object: { claimId: { id: 'claim' } } }
    ] as const) {
      assert.deepEqual(parseType(formatType(type)), type);
    }
    assert.equal(formatType({ list: { id: 'payerFile' } }), 'list<id<payerFile>>');
    assert.deepEqual(parseType('id<person>'), { id: 'person' });
    assert.throws(() => parseType('id<Person>'), /Invalid kind "Person"/);
    assert.throws(() => parseType('code'), /Expected "<"/);
  });

  it('refuses to mix kinds or to treat plain text as a kind', () => {
    assert.equal(isAssignable({ id: 'patient' }, { id: 'patient' }), true);
    assert.equal(isAssignable({ id: 'patient' }, 'string'), true);
    assert.equal(isAssignable({ id: 'patient' }, { id: 'claim' }), false);
    assert.equal(isAssignable({ id: 'claim' }, { code: 'hcpcs' }), false);
    assert.equal(isAssignable('string', { id: 'patient' }), false);
    assert.equal(isAssignable('datetime', { code: 'hcpcs' }), false);
    assert.equal(isAssignable({ code: 'hcpcs' }, 'datetime'), false);
    assert.equal(isAssignable({ code: 'hcpcs' }, 'number'), false);
    assert.equal(isAssignable('any', { id: 'patient' }), true);
    assert.equal(isAssignable({ id: 'patient' }, 'any'), true);
    assert.equal(isAssignable({ list: { code: 'icd10' } }, { list: 'string' }), true);
    assert.equal(isAssignable({ list: 'string' }, { list: { code: 'icd10' } }), false);
  });

  it('assigns objects only when every field of the target is there and fits', () => {
    const claim = { object: { id: { id: 'claim' }, total: 'integer' } } as const;
    assert.equal(isAssignable(claim, { object: { id: { id: 'claim' } } }), true);
    assert.equal(isAssignable(claim, { object: { id: 'string', total: 'number' } }), true);
    assert.equal(isAssignable(claim, { object: {} }), true);
    assert.equal(isAssignable({ object: {} }, claim), false);
    assert.equal(isAssignable({ object: { id: { id: 'claim' } } }, claim), false);
    assert.equal(isAssignable({ object: { id: { id: 'task' }, total: 'integer' } }, claim), false);
    const inherited = JSON.parse('{"object":{"toString":"string"}}') as ValueType;
    assert.equal(isAssignable(inherited, inherited), true);
    assert.equal(isAssignable({ object: {} }, inherited), false);
  });

  it('tells types entered as plain text', () => {
    assert.equal(isTextType('string'), true);
    assert.equal(isTextType({ id: 'payer' }), true);
    assert.equal(isTextType({ code: 'icd10' }), true);
    assert.equal(isTextType('datetime'), false);
    assert.equal(isTextType({ list: 'string' }), false);
  });

  it('checks runtime values of kinds as text', () => {
    assert.equal(checkValue({ id: 'claim' }, 'c1'), null);
    assert.equal(checkValue({ code: 'hcpcs' }, 410), 'expected code<hcpcs>, got number');
  });

  it('checks runtime values with paths in messages', () => {
    assert.equal(checkValue('number', null), null);
    assert.equal(checkValue('integer', 1.5), 'expected integer, got number');
    assert.equal(checkValue('datetime', '2026-01-01'), null);
    assert.equal(checkValue('datetime', 'soon'), 'expected datetime, got string');
    assert.equal(checkValue({ list: 'number' }, [1, 'x']), '[1]: expected number, got string');
    assert.equal(
      checkValue({ object: { id: 'string' } }, { id: 3 }),
      'id: expected string, got number'
    );
    assert.equal(checkValue('boolean', 'true'), 'expected boolean, got string');
    assert.equal(checkValue({ list: 'number' }, { a: 1 }), 'expected list<number>, got object');
    assert.equal(checkValue({ object: { id: 'string' } }, {}), null);
    assert.equal(checkValue({ list: 'number' }, [1, null]), null);
    assert.equal(
      checkValue({ object: { id: 'string' } }, [1]),
      'expected object{id: string}, got list'
    );
    assert.equal(checkValue('string', true), 'expected string, got boolean');
    assert.equal(checkValue('any', { a: [true, 'x'] }), null);
  });

  it('rejects values that would change when saved as JSON', () => {
    assert.equal(checkValue('any', Number.NaN), 'not a finite number');
    assert.equal(
      checkValue('any', { a: [1, Number.POSITIVE_INFINITY] }),
      'a: [1]: not a finite number'
    );
    assert.equal(checkValue({ object: {} }, { extra: Number.NaN }), 'extra: not a finite number');
    const inherited = JSON.parse('{"object":{"toString":"string"}}') as ValueType;
    assert.equal(checkValue(inherited, {}), null);
  });

  it('tells a file reference type, an object of exactly a bucket and a key', () => {
    assert.equal(isFileType({ object: { key: 'string', bucket: 'string' } }), true);
    assert.equal(isFileType({ object: { key: 'string' } }), false);
    assert.equal(isFileType('string'), false);
  });
});

describe('kinds', () => {
  const kinds = mergeKinds(STD_KINDS, { id: { claim: 'Claim ID' }, code: { hcpcs: 'HCPCS Code' } });

  it('merges the kinds each domain knows', () => {
    assert.deepEqual(kinds, {
      id: { run: 'Run ID', claim: 'Claim ID' },
      code: { hcpcs: 'HCPCS Code' }
    });
  });

  it('lists the kinds a type uses that nobody declared', () => {
    assert.deepEqual(unknownKinds({ id: 'claim' }, kinds), []);
    assert.deepEqual(
      unknownKinds(
        { object: { a: { list: { code: 'hcpc' } }, b: { id: 'claim' }, c: { id: 'toString' } } },
        kinds
      ),
      ['code<hcpc>', 'id<toString>']
    );
    assert.deepEqual(unknownKinds('string', kinds), []);
    assert.deepEqual(unknownKinds({ code: 'hcpcs' }, kinds), []);
    assert.deepEqual(unknownKinds({ code: 'icd9' }, STD_KINDS), ['code<icd9>']);
  });
});

describe('field paths', () => {
  const claim = {
    object: { id: { id: 'claim' }, patient: { object: { name: 'string', meta: 'any' } } }
  } as const;

  it('finds the type at a dotted path, any below an any, and nothing for unknown or blank keys', () => {
    assert.deepEqual(fieldType(claim, 'id'), { id: 'claim' });
    assert.equal(fieldType(claim, 'patient.name'), 'string');
    assert.equal(fieldType(claim, 'patient.meta.deep.er'), 'any');
    assert.equal(fieldType('any', 'x'), 'any');
    assert.equal(fieldType(claim, 'patient.age'), null);
    assert.equal(fieldType(claim, 'id.value'), null);
    assert.equal(fieldType(claim, 'patient..name'), null);
    assert.equal(fieldType(claim, ''), null);
    assert.equal(fieldType({ object: {} }, 'toString'), null);
  });

  it('lists every field path of an object type, depth first', () => {
    assert.deepEqual(fieldPaths(claim), [
      { path: 'id', type: { id: 'claim' } },
      { path: 'patient', type: claim.object.patient },
      { path: 'patient.name', type: 'string' },
      { path: 'patient.meta', type: 'any' }
    ]);
    assert.deepEqual(fieldPaths({ list: claim }), []);
    assert.deepEqual(fieldPaths('string'), []);
  });
});
