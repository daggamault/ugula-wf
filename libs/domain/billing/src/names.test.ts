import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { firstNameLikeness, jaroWinkler, NICKNAME_LIKENESS, nameKey } from './names.ts';

const near = (actual: number, expected: number) =>
  assert.equal(Math.round(actual * 1000) / 1000, expected);

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

  it('boosts a shared prefix of up to four letters', () => {
    near(jaroWinkler('abcd', 'abcz'), 0.883);
    near(jaroWinkler('abcdef', 'abcdez'), 0.933);
  });
});

describe('first names', () => {
  it('treats nicknames of the same name as alike, in either direction', () => {
    const pairs = [
      ['bob', 'robert'],
      ['robert', 'bob'],
      ['pat', 'patricia'],
      ['pat', 'patrick'],
      ['patricia', 'patrick'],
      ['zelda', 'zeldo'],
      ['bob', 'zelda']
    ] as const;
    assert.deepEqual(
      pairs.map(([a, b]) => firstNameLikeness(a, b) === NICKNAME_LIKENESS),
      [true, true, true, true, false, false, false]
    );
    assert.equal(firstNameLikeness('bob', 'zelda'), 0);
  });

  it('ranks exact names, nicknames, initials and spelling variants', () => {
    assert.equal(firstNameLikeness('jane', 'jane'), 1);
    assert.equal(firstNameLikeness('bill', 'william'), 0.95);
    assert.equal(firstNameLikeness('j', 'john'), 0.85);
    assert.equal(firstNameLikeness('k', 'john'), 0);
    assert.equal(firstNameLikeness('john', 'j'), 0.85);
    near(firstNameLikeness('bob', 'bobbie'), 0.883);
    assert.equal(firstNameLikeness('janet', 'jane'), 0.94);
    assert.equal(firstNameLikeness('jane', 'mark'), 0.5);
    assert.equal(firstNameLikeness('', 'jane'), 0);
    assert.equal(firstNameLikeness('jane', ''), 0);
  });
});
