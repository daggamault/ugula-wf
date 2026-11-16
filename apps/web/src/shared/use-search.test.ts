import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { searchStatus } from './use-search.ts';

describe('searchStatus', () => {
  it('says what a search is doing when it shows nothing', () => {
    const prompt = 'Type part of a name';
    assert.equal(searchStatus('', false, undefined, prompt), prompt);
    assert.equal(searchStatus('chest', true, undefined, prompt), 'Searching…');
    assert.equal(searchStatus('zzz', false, undefined, prompt), 'No matches');
    assert.equal(searchStatus('chest', false, new Error('Offline'), prompt), 'Offline');
  });
});
