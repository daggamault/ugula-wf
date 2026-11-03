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

describe('downloadText', () => {
  it('saves text as a named file and releases its object URL', async () => {
    const clicked: { href: string; download: string }[] = [];
    const revoked: string[] = [];
    let blob: Blob | null = null;
    URL.createObjectURL = (b: Blob) => {
      blob = b;
      return 'blob:1';
    };
    URL.revokeObjectURL = (url: string) => void revoked.push(url);
    Object.assign(globalThis, {
      document: {
        createElement: () => {
          const link = { href: '', download: '', click: () => clicked.push({ ...link }) };
          return link;
        }
      }
    });
    downloadText('elig.x12', 'ISA*', 'application/edi-x12');
    assert.deepEqual(
      clicked.map(({ href, download }) => [href, download]),
      [['blob:1', 'elig.x12']]
    );
    assert.deepEqual(revoked, ['blob:1']);
    assert.equal(await (blob as unknown as Blob).text(), 'ISA*');
  });
});
