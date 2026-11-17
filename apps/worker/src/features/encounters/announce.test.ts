import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LiveEvent } from '@ugula/live';
import type { EncounterStore } from '@ugula/nemsis';
import { announceEncounters } from './announce.ts';

describe('announceEncounters', () => {
  it('announces imports once an encounter is saved, since its report now shows the outcome', async () => {
    const announced: LiveEvent[] = [];
    const store = announceEncounters(
      {
        saveEncounter: async () => ({ id: 'e1', revision: 1, outcome: 'created' }),
        findEncounter: async () => null
      } satisfies EncounterStore,
      async (_, event) => void announced.push(event)
    );
    assert.deepEqual(await store.saveEncounter('r1', 'A', {}, null), {
      id: 'e1',
      revision: 1,
      outcome: 'created'
    });
    assert.deepEqual(announced, [{ kind: 'import', id: null }]);
    assert.equal(await store.findEncounter('r1', 'e1'), null);
  });
});
