import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent, within } from '../testing-dom.ts';
import { Pagination, pageCount, rangeText } from './pagination.tsx';

const LINKS = ['First Page', 'Previous Page', 'Next Page', 'Last Page'];

const show = (page: number, total: number, hasSizes = true) =>
  render(
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

const nav = () => screen.getByRole('navigation', { name: 'Claims pages' });

const controlOf = (name: string) =>
  within(nav()).queryByRole('link', { name }) ?? within(nav()).getByRole('button', { name });

describe('rangeText', () => {
  it('says which rows are shown out of how many', () => {
    assert.equal(rangeText(2, 25, 132), '26–50 of 132');
    assert.equal(rangeText(6, 25, 132), '126–132 of 132');
    assert.equal(rangeText(1, 25, 1500), '1–25 of 1,500');
  });

  it('pins a page past the end to the last row', () => {
    assert.equal(rangeText(9, 25, 132), '132–132 of 132');
  });

  it('says there are no results for an empty list', () => {
    assert.equal(rangeText(1, 25, 0), 'No results');
  });
});

describe('pageCount', () => {
  it('rounds up to whole pages and never drops below one', () => {
    assert.equal(pageCount(0, 25), 1);
    assert.equal(pageCount(50, 25), 2);
    assert.equal(pageCount(51, 25), 3);
  });
});

describe('Pagination', () => {
  it('shows only the range when everything fits on the first page', () => {
    show(1, 4);
    assert.ok(!screen.queryByRole('navigation'));
    assert.equal(screen.getByText('1–4 of 4').tagName, 'P');
  });

  it('announces the range and page politely', () => {
    show(2, 132);
    const range = within(nav()).getByText('26–50 of 132 · Page 2 of 6');
    assert.equal(range.getAttribute('aria-live'), 'polite');
  });

  it('links to the first, previous, next and last pages from the middle', () => {
    show(2, 132);
    assert.deepEqual(
      LINKS.map((name) => {
        const link = within(nav()).getByRole('link', { name });
        return [link.getAttribute('href'), link.getAttribute('rel')];
      }),
      [
        ['/claims?page=1', null],
        ['/claims?page=1', 'prev'],
        ['/claims?page=3', 'next'],
        ['/claims?page=6', null]
      ]
    );
  });

  it('disables the ends with a reason when there is one page', () => {
    show(1, 20);
    assert.equal(within(nav()).queryAllByRole('link').length, 0);
    assert.deepEqual(
      LINKS.map((name) => {
        const button = within(nav()).getByRole('button', { name });
        return [
          button.getAttribute('aria-disabled'),
          document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent
        ];
      }),
      [
        ['true', 'Already on the first page'],
        ['true', 'Already on the first page'],
        ['true', 'Already on the last page'],
        ['true', 'Already on the last page']
      ]
    );
    assert.equal(within(nav()).getByText('1–20 of 20').getAttribute('aria-live'), 'polite');
  });

  it('brings a page past the end back to the last page', () => {
    show(9, 132);
    assert.equal(
      within(nav()).getByRole('link', { name: 'Previous Page' }).getAttribute('href'),
      '/claims?page=6'
    );
    assert.equal(controlOf('Next Page').getAttribute('aria-disabled'), 'true');
    assert.equal(controlOf('Last Page').getAttribute('aria-disabled'), 'true');
  });

  it('goes to another page in place when a page link is followed', async () => {
    show(2, 132);
    await userEvent.setup().click(within(nav()).getByRole('link', { name: 'Next Page' }));
    assert.equal(`${window.location.pathname}${window.location.search}`, '/claims?page=3');
  });

  it('offers each page size with the current one chosen', () => {
    show(2, 132);
    const picker = within(nav()).getByRole('button', { name: 'Rows Per Page' });
    assert.equal(picker.textContent, '25');
    assert.deepEqual(
      within(nav())
        .getAllByRole('option')
        .map((o) => [o.textContent, o.getAttribute('aria-selected')]),
      [
        ['10', 'false'],
        ['25', 'true'],
        ['50', 'false'],
        ['100', 'false']
      ]
    );
  });

  it('navigates to the chosen page size', async () => {
    show(2, 132);
    await userEvent.setup().click(within(nav()).getByRole('option', { name: '50' }));
    assert.equal(`${window.location.pathname}${window.location.search}`, '/claims?pageSize=50');
  });

  it('leaves out the page size picker when the list has fixed pages', () => {
    show(2, 132, false);
    assert.ok(!within(nav()).queryByRole('button', { name: 'Rows Per Page' }));
    assert.ok(!within(nav()).queryByRole('listbox'));
  });
});
