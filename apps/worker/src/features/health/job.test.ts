import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HEALTH_QUEUE, registerHealthJob } from './job.ts';

describe('registerHealthJob', () => {
  it('registers the health queue', async () => {
    let created = '';
    const boss = {
      createQueue: async (name: string) => {
        created = name;
      },
      work: async () => 'health-worker'
    };

    const id = await registerHealthJob(boss);
    assert.equal(created, HEALTH_QUEUE);
    assert.equal(id, 'health-worker');
  });
});
