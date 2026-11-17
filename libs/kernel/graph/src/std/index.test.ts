import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { createStdNodes } from './index.ts';

const TASK = { title: 'Review', queue: 'coding', outcomes: ['done'] };

const humanConfig = (permissions?: readonly string[]) => {
  const human = createStdNodes(permissions ? { fetch, permissions } : { fetch }).find(
    (d) => d.type === 'std.human.task'
  );
  assert.ok(human?.config);
  return human.config;
};

describe('createStdNodes', () => {
  it('gives every node a unique std type and version', () => {
    const keys = createStdNodes({ fetch }).map((d) => `${d.type}@${d.version}`);
    assert.equal(new Set(keys).size, keys.length);
    assert.deepEqual(
      keys.filter((k) => !k.startsWith('std.')),
      []
    );
  });

  it('documents every node with a title, category and description', () => {
    assert.deepEqual(
      createStdNodes({ fetch })
        .filter((d) => !d.title || !d.category || !d.description)
        .map((d) => d.type),
      []
    );
  });

  it('groups the catalog into its categories', () => {
    assert.deepEqual([...new Set(createStdNodes({ fetch }).map((d) => d.category))].sort(), [
      'Conversion',
      'Flow',
      'Human',
      'Lists',
      'Logic',
      'Math',
      'Network',
      'Objects',
      'Tables',
      'Text',
      'Time',
      'Variables'
    ]);
  });

  it('lets a human task require any well-formed permission when none are listed', () => {
    assert.equal(v.safeParse(humanConfig(), { ...TASK, permission: 'claims:read' }).success, true);
  });

  it('limits a human task to the permissions it is given', () => {
    const config = humanConfig(['claims:read']);
    assert.equal(v.safeParse(config, { ...TASK, permission: 'claims:read' }).success, true);
    assert.deepEqual(
      v.safeParse(config, { ...TASK, permission: 'fees:read' }).issues?.map((i) => i.message),
      ['Unknown permission']
    );
  });
});
