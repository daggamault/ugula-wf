import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { parseConfig } from './config.ts';

const docWith = (attributes: Record<string, string> | null) => {
  const selectors: string[] = [];
  const doc = {
    querySelector: (selector: string) => {
      selectors.push(selector);
      return attributes === null
        ? null
        : ({ getAttribute: (name: string) => attributes[name] ?? null } as unknown as Element);
    }
  };
  return { doc, selectors };
};

describe('parseConfig', () => {
  it('reads the api url from the api-url meta tag', () => {
    const { doc, selectors } = docWith({ content: 'http://localhost:3001' });
    assert.deepEqual(parseConfig(doc), { apiUrl: 'http://localhost:3001' });
    assert.deepEqual(selectors, ['meta[name="api-url"]']);
  });

  it('refuses a page without the api-url meta tag', () => {
    assert.throws(() => parseConfig(docWith(null).doc), v.ValiError);
  });

  it('refuses a meta tag without content', () => {
    assert.throws(() => parseConfig(docWith({}).doc), v.ValiError);
  });

  it('refuses an empty api url', () => {
    assert.throws(() => parseConfig(docWith({ content: '' }).doc), v.ValiError);
  });

  it('refuses an api url that is not a url', () => {
    assert.throws(() => parseConfig(docWith({ content: 'localhost' }).doc), v.ValiError);
  });
});
