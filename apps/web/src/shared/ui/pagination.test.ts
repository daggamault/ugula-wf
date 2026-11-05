import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Pagination, pageCount, rangeText } from './pagination.tsx';

const render = (page: number, total: number, hasSizes = true) =>
  renderToStaticMarkup(
    createElement(Pagination, {
      label: 'Claims',
      total,
      state: {
        page,
        pageSize: 25,
        pageHref: (n) => `/claims?page=${n}`,
        ...(hasSizes ? { sizeHref: (n: number) => `/claims?pageSize=${n}` } : {})
      }
    })
  );

describe('Pagination', () => {
  it('says which rows are shown out of how many', () => {
    assert.equal(rangeText(2, 25, 132), '26–50 of 132');
    assert.equal(rangeText(6, 25, 132), '126–132 of 132');
    assert.equal(rangeText(9, 25, 132), '132–132 of 132');
    assert.equal(rangeText(1, 25, 1500), '1–25 of 1,500');
    assert.equal(rangeText(1, 25, 0), 'No results');
    assert.equal(pageCount(0, 25), 1);
    assert.equal(pageCount(50, 25), 2);
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
    assert.match(middle, /href="\/claims\?page=1" rel="prev"/);
    assert.match(middle, /href="\/claims\?page=3" rel="next"/);
    assert.ok(middle.includes('Page 2 of 6') && middle.includes('Rows Per Page'));
    assert.ok(middle.includes('aria-live="polite"'));
    assert.ok(!middle.includes('aria-disabled="true"'));
    const first = render(1, 20);
    assert.equal(first.match(/aria-disabled="true"/g)?.length, 4);
    assert.ok(first.includes('Already on the first page'));
    assert.ok(first.includes('Already on the last page'));
    assert.match(
      first,
      /role="option"[^>]*aria-selected="false" data-value="100"[^>]*><span[^>]*>100<\/span>/
    );
    assert.equal(render(1, 4), '<p class="text-surface-fg-muted text-sm">1–4 of 4</p>');
  });

  it('brings a page past the end back to the last page', () => {
    const past = render(9, 132);
    assert.match(past, /href="\/claims\?page=6" rel="prev"/);
    assert.equal(past.match(/aria-disabled="true"/g)?.length, 2);
  });

  it('leaves out the page size picker when the list has fixed pages', () => {
    const html = render(2, 132, false);
    assert.ok(!html.includes('Rows Per Page') && !html.includes('aria-haspopup="listbox"'));
  });
});
