import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent, within } from '../testing-dom.ts';
import { Tabs } from './tabs.tsx';

type TabsProps = Parameters<typeof Tabs>[0];

const TABS: TabsProps['tabs'] = [
  { label: 'Overview', href: '/claims/c1', isSelected: true },
  { label: 'History', href: '/claims/c1?tab=history', isSelected: false, count: 3 },
  { label: 'Files', href: '/claims/c1?tab=files', isSelected: false, count: 0 }
];

const showTabs = (tabs: TabsProps['tabs'] = TABS) => {
  const view = render(createElement(Tabs, { label: 'Claim Sections', tabs }));
  const nav = screen.getByRole('navigation', { name: 'Claim Sections' });
  return { ...view, nav, user: userEvent.setup() };
};

describe('Tabs', () => {
  it('is a navigation landmark of links in order', () => {
    const { nav } = showTabs();
    assert.deepEqual(
      within(nav)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
      [
        ['Overview', '/claims/c1'],
        ['History3', '/claims/c1?tab=history'],
        ['Files', '/claims/c1?tab=files']
      ]
    );
  });

  it('marks only the selected tab as the current page', () => {
    const { nav } = showTabs();
    assert.deepEqual(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.getAttribute('aria-current')),
      ['page', null, null]
    );
  });

  it('marks no tab current when none is selected', () => {
    const { nav } = showTabs(TABS.map((t) => ({ ...t, isSelected: false })));
    assert.equal(nav.querySelectorAll('[aria-current]').length, 0);
    assert.equal(nav.querySelectorAll('[aria-hidden="true"]').length, 0);
  });

  it('shows a count beside a tab, and none for zero', () => {
    showTabs();
    assert.equal(screen.getByRole('link', { name: 'History 3' }).textContent, 'History3');
    assert.ok(!screen.getByRole('link', { name: 'Files' }).querySelector('span'));
  });

  it('tints the count on the selected tab', () => {
    showTabs([
      { label: 'Review', href: '/tasks', isSelected: true, count: 2 },
      { label: 'Done', href: '/tasks?q=done', isSelected: false, count: 5 }
    ]);
    const countOf = (name: string) =>
      screen.getByRole('link', { name }).querySelector('span')?.classList;
    assert.ok(countOf('Review 2')?.contains('bg-primary-fg/20'));
    assert.ok(countOf('Done 5')?.contains('bg-surface-fg/8'));
  });

  it('slides a decorative indicator under the selected tab once measured', () => {
    const { nav } = showTabs();
    const indicators = nav.querySelectorAll('[aria-hidden="true"]');
    assert.equal(indicators.length, 1);
    assert.ok(indicators[0]?.classList.contains('bg-primary'));
    const current = screen.getByRole('link', { name: 'Overview' });
    assert.ok(!current.classList.contains('aria-[current=page]:bg-primary'));
  });

  it('fills the selected pill itself when there is no indicator', () => {
    showTabs(TABS.map((t) => ({ ...t, isSelected: false })));
    assert.ok(
      screen
        .getByRole('link', { name: 'Overview' })
        .classList.contains('aria-[current=page]:bg-primary')
    );
  });

  it('navigates in place when a tab is clicked', async () => {
    const { user } = showTabs();
    await user.click(screen.getByRole('link', { name: 'History 3' }));
    assert.equal(`${window.location.pathname}${window.location.search}`, '/claims/c1?tab=history');
  });
});
