import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { firstNameLikeness, isNickname, jaroWinkler, nameKey } from './names.ts';

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.001);

describe('nameKey', () => {
  it('ignores case, accents, spaces and punctuation', () => {
    assert.equal(nameKey("  O'Brién-Smith "), 'obriensmith');
    assert.equal(nameKey('123'), '');
  });
});

describe('jaroWinkler', () => {
  it('matches the published reference values', () => {
    near(jaroWinkler('martha', 'marhta'), 0.961);
    near(jaroWinkler('dwayne', 'duane'), 0.84);
    near(jaroWinkler('dixon', 'dicksonx'), 0.813);
  });

  it('scores identical, empty and unrelated names', () => {
    assert.equal(jaroWinkler('smith', 'smith'), 1);
    assert.equal(jaroWinkler('', ''), 0);
    assert.equal(jaroWinkler('smith', ''), 0);
    assert.equal(jaroWinkler('abc', 'xyz'), 0);
  });
});

describe('first names', () => {
  it('treats nicknames of the same name as alike, in either direction', () => {
    assert.ok(isNickname('bob', 'robert'));
    assert.ok(isNickname('pat', 'patricia') && isNickname('pat', 'patrick'));
    assert.ok(!isNickname('patricia', 'patrick'));
    assert.ok(!isNickname('zelda', 'zelda'));
  });

  it('ranks exact names, nicknames, initials and spelling variants', () => {
    assert.equal(firstNameLikeness('jane', 'jane'), 1);
    assert.equal(firstNameLikeness('bill', 'william'), 0.95);
    assert.equal(firstNameLikeness('j', 'john'), 0.85);
    assert.equal(firstNameLikeness('k', 'john'), 0);
    assert.ok(firstNameLikeness('jon', 'john') > 0.9);
    assert.equal(firstNameLikeness('janet', 'jane'), 0.94);
    assert.ok(firstNameLikeness('jane', 'mark') < 0.6);
    assert.equal(firstNameLikeness('', 'jane'), 0);
  });
});
