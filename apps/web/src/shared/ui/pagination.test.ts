import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Pagination, pageCount, rangeText } from './pagination.tsx';

const render = (page: number, total: number) =>
  renderToStaticMarkup(
    createElement(Pagination, {
      label: 'Claims',
      total,
      state: {
        page,
        pageSize: 25,
        pageHref: (n) => `/claims?page=${n}`,
        sizeHref: (n) => `/claims?pageSize=${n}`
      }
    })
  );

describe('Pagination', () => {
  it('says which rows are shown out of how many', () => {
    assert.equal(rangeText(2, 25, 132), '26–50 of 132');
    assert.equal(rangeText(6, 25, 132), '126–132 of 132');
    assert.equal(rangeText(1, 25, 0), 'No results');
    assert.equal(pageCount(0, 25), 1);
    assert.equal(pageCount(51, 25), 3);
  });

  it('links to the first, previous, next and last pages and disables the ends', () => {
    const middle = render(2, 132);
    assert.ok(middle.includes('aria-label="Claims pages"'));
    for (const name of ['First Page', 'Previous Page', 'Next Page', 'Last Page']) {
      assert.ok(middle.includes(`aria-label="${name}"`), name);
    }
    assert.ok(middle.includes('href="/claims?page=1"') && middle.includes('href="/claims?page=3"'));
    assert.ok(middle.includes('href="/claims?page=6"'));
    assert.ok(middle.includes('Page 2 of 6') && middle.includes('Rows Per Page'));
    assert.ok(!middle.includes('aria-disabled="true"'));
    const first = render(1, 20);
    assert.equal(first.match(/aria-disabled="true"/g)?.length, 4);
    assert.ok(first.includes('Already on the first page'));
    assert.ok(first.includes('<option value="100">100</option>'));
    assert.equal(render(1, 4), '<p class="text-surface-fg-muted text-sm">1–4 of 4</p>');
  });
});
