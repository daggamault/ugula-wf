import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent, waitFor } from './testing-dom.ts';
import { searchStatus, useSearch } from './use-search.ts';

const PROMPT = 'Type part of a name';

const Probe = ({ load }: { load: (q: string, signal: AbortSignal) => Promise<string[]> }) => {
  const { q, results, onSearch, emptyText } = useSearch('payers', load, PROMPT);
  return createElement(
    'div',
    null,
    createElement('input', {
      'aria-label': 'Search',
      onChange: (e: { target: { value: string } }) => onSearch(e.target.value)
    }),
    createElement('output', null, `${q}|${results.join(',')}|${emptyText}`)
  );
};

const shown = () => screen.getByRole('status').textContent;

describe('useSearch', () => {
  it('waits for typing to pause, then searches the trimmed text once', async () => {
    const asked: string[] = [];
    const load = async (q: string) => {
      asked.push(q);
      return q ? [`${q} Health`] : [];
    };
    render(createElement(Probe, { load }));
    await waitFor(() => assert.equal(shown(), `||${PROMPT}`));
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Search' }), '  aetna ');
    assert.deepEqual(asked, ['']);
    await waitFor(() => assert.equal(shown(), 'aetna|aetna Health|No matches'));
    assert.deepEqual(asked, ['', 'aetna']);
  });

  it('says it is searching while the results load and shows a failure', async () => {
    const pending: ((err: Error) => void)[] = [];
    const load = (q: string) =>
      q ? new Promise<string[]>((_, reject) => pending.push(reject)) : Promise.resolve([]);
    render(createElement(Probe, { load }));
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'blue');
    await waitFor(() => assert.equal(shown(), 'blue||Searching…'));
    pending[0]?.(new Error('Offline'));
    await waitFor(() => assert.equal(shown(), 'blue||Offline'));
  });

  it('clears the search at once when the text is emptied', async () => {
    const load = async (q: string) => (q ? [q] : []);
    render(createElement(Probe, { load }));
    const user = userEvent.setup();
    const box = screen.getByRole('textbox', { name: 'Search' });
    await user.type(box, 'blue');
    await waitFor(() => assert.equal(shown(), 'blue|blue|No matches'));
    await user.clear(box);
    await waitFor(() => assert.equal(shown(), `||${PROMPT}`), { timeout: 100 });
  });
});

describe('searchStatus', () => {
  it('says what a search is doing when it shows nothing', () => {
    assert.equal(searchStatus('', false, undefined, PROMPT), PROMPT);
    assert.equal(searchStatus('chest', true, undefined, PROMPT), 'Searching…');
    assert.equal(searchStatus('zzz', false, undefined, PROMPT), 'No matches');
    assert.equal(searchStatus('chest', false, new Error('Offline'), PROMPT), 'Offline');
  });
});
