import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { downloadText } from './download.ts';

const original = {
  document: globalThis.document,
  create: URL.createObjectURL,
  revoke: URL.revokeObjectURL
};

afterEach(() => {
  Object.assign(globalThis, { document: original.document });
  URL.createObjectURL = original.create;
  URL.revokeObjectURL = original.revoke;
});

const fakeBrowser = () => {
  const steps: string[] = [];
  const blobs: Blob[] = [];
  const tags: string[] = [];
  URL.createObjectURL = (blob: Blob) => {
    blobs.push(blob);
    steps.push('create blob:1');
    return 'blob:1';
  };
  URL.revokeObjectURL = (url: string) => void steps.push(`revoke ${url}`);
  Object.assign(globalThis, {
    document: {
      createElement: (tag: string) => {
        tags.push(tag);
        const link = {
          href: '',
          download: '',
          click: () => steps.push(`click ${link.href} ${link.download}`)
        };
        return link;
      }
    }
  });
  return { blobs, steps, tags };
};

describe('downloadText', () => {
  it('clicks a link to the text saved under the file name, then releases the URL', () => {
    const { steps, tags } = fakeBrowser();
    downloadText('elig.x12', 'ISA*', 'application/edi-x12');
    assert.deepEqual(tags, ['a']);
    assert.deepEqual(steps, ['create blob:1', 'click blob:1 elig.x12', 'revoke blob:1']);
  });

  it('saves the text with the content type it is given', async () => {
    const { blobs } = fakeBrowser();
    downloadText('claims.csv', 'id,total\nc1,100', 'text/csv');
    assert.equal(blobs.length, 1);
    assert.equal(blobs[0]?.type, 'text/csv');
    assert.equal(await blobs[0]?.text(), 'id,total\nc1,100');
  });
});
