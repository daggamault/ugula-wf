import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, within } from '../testing-dom.ts';
import { Section, SectionPanel } from './section-panel.tsx';

describe('SectionPanel', () => {
  it('names the region by its heading', () => {
    render(createElement(SectionPanel, { title: 'Payers', children: 'List' }));
    const region = screen.getByRole('region', { name: 'Payers' });
    assert.equal(within(region).getByRole('heading', { level: 2 }).textContent, 'Payers');
  });

  it('shows the description, actions and content', () => {
    render(
      createElement(SectionPanel, {
        title: 'Payers',
        description: 'Billed in order.',
        actions: createElement('button', { type: 'button' }, 'Save'),
        children: createElement('p', null, 'List')
      })
    );
    const region = screen.getByRole('region', { name: 'Payers' });
    assert.equal(within(region).getByText('Billed in order.').tagName, 'P');
    assert.equal(within(region).getByRole('button').textContent, 'Save');
    assert.equal(within(region).getByText('List').tagName, 'P');
  });

  it('shows only the heading when nothing else is given', () => {
    render(createElement(SectionPanel, { title: 'Payers' }));
    const region = screen.getByRole('region', { name: 'Payers' });
    assert.equal(region.textContent, 'Payers');
    assert.equal(region.children.length, 1);
  });

  it('frames a plain panel with the neutral border', () => {
    render(createElement(SectionPanel, { title: 'Payers' }));
    assert.equal(screen.getByRole('region').classList.contains('border-border'), true);
  });

  it('highlights an accented panel in its accent color', () => {
    for (const accent of ['primary', 'warning', 'custom'] as const) {
      const { unmount } = render(createElement(SectionPanel, { title: 'Decision', accent }));
      const region = screen.getByRole('region', { name: 'Decision' });
      assert.equal(region.classList.contains('border-border'), false, accent);
      assert.equal(
        [...region.classList].some((c) => c.startsWith(`border-${accent}/`)),
        true,
        accent
      );
      unmount();
    }
  });
});

describe('Section', () => {
  it('names an unframed region by its heading and shows its content', () => {
    render(
      createElement(Section, {
        title: 'Queues',
        description: 'Waiting work.',
        actions: createElement('button', { type: 'button' }, 'Add'),
        children: createElement('p', null, 'T')
      })
    );
    const region = screen.getByRole('region', { name: 'Queues' });
    assert.equal(within(region).getByRole('heading', { level: 2 }).textContent, 'Queues');
    assert.equal(within(region).getByText('Waiting work.').tagName, 'P');
    assert.equal(within(region).getByRole('button').textContent, 'Add');
    assert.equal(within(region).getByText('T').tagName, 'P');
    assert.equal(region.classList.contains('border'), false);
  });

  it('leaves out the description and actions when not given', () => {
    render(createElement(Section, { title: 'Queues' }));
    const region = screen.getByRole('region', { name: 'Queues' });
    assert.equal(region.textContent, 'Queues');
    assert.ok(!within(region).queryByRole('button'));
  });
});
