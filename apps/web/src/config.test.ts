import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseConfig } from './config.ts';

const createMockDoc = (meta: Record<string, string>) => ({
  querySelector: (selector: string) => {
    const match = selector.match(/^meta\[name="(.+)"\]$/);
    const val = match?.[1] ? meta[match[1]] : undefined;
    return val !== undefined ? ({ getAttribute: () => val } as unknown as Element) : null;
  }
});

describe('web parseConfig', () => {
  it('parses apiUrl from meta tag and rejects missing tag', () => {
    const doc = createMockDoc({ 'api-url': 'http://localhost:3001' });
    assert.deepEqual(parseConfig(doc), { apiUrl: 'http://localhost:3001' });
    assert.throws(() => parseConfig(createMockDoc({})));
  });
});
