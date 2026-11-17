import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef } from '@ugula/graph';
import { createElement } from 'react';
import { createCatalog } from '../../shared/graph/catalog.ts';
import { testNodes } from '../../shared/testing.ts';
import { render, screen, userEvent, within } from '../../shared/testing-dom.ts';
import { DocumentationHints, documentationHints, EditorNotices } from './editor-notices.tsx';

const def = (patch: Partial<GraphDef> = {}): GraphDef => ({
  signature: {
    execIn: ['exec'],
    execOut: [],
    inputs: [{ name: 'x', type: 'number' }],
    outputs: []
  },
  variables: [],
  nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1, label: 'go here' }],
  edges: [],
  ...patch
});

const notices = (props: Partial<Parameters<typeof EditorNotices>[0]> = {}) =>
  render(
    createElement(EditorNotices, {
      error: '',
      issues: [],
      hints: [],
      base: null,
      compareHref: '/?panel=compare',
      emptySlot: null,
      ...props
    })
  );

const texts = (role: 'status' | 'alert') => screen.queryAllByRole(role).map((el) => el.textContent);

describe('documentationHints', () => {
  it('names the node a hint is about by its title rather than its label', () => {
    assert.deepEqual(documentationHints(def(), createCatalog(testNodes)), [
      'Describe the input "x"',
      'Entry: Write the label "go here" in Title Case'
    ]);
  });

  it('has nothing to say about a documented graph', () => {
    const documented = def({
      signature: {
        execIn: ['exec'],
        execOut: [],
        inputs: [{ name: 'x', type: 'number', description: 'The amount.' }],
        outputs: []
      },
      nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1 }]
    });
    assert.deepEqual(documentationHints(documented, createCatalog(testNodes)), []);
  });
});

describe('DocumentationHints', () => {
  it('counts the hints in a warning that expands to list them', async () => {
    render(createElement(DocumentationHints, { hints: ['Fix x', 'Fix y'] }));
    const summary = screen.getByText('2 Documentation Hints');
    const details = summary.closest('details');
    assert.ok(details);
    assert.equal(details.open, false);
    await userEvent.setup().click(summary);
    assert.equal(details.open, true);
    assert.deepEqual(
      within(details)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
      ['Fix x', 'Fix y']
    );
  });

  it('says hint in the singular for one', () => {
    render(createElement(DocumentationHints, { hints: ['Fix x'] }));
    assert.ok(screen.getByText('1 Documentation Hint'));
  });
});

describe('EditorNotices', () => {
  it('renders nothing without anything to say', () => {
    const { container } = notices();
    assert.equal(container.innerHTML, '');
  });

  it('shows the error as an alert', () => {
    notices({ error: 'Boom' });
    assert.deepEqual(texts('alert'), ['Boom']);
    assert.deepEqual(texts('status'), []);
  });

  it('explains that runs use a stale base, with a link to compare', () => {
    notices({ base: 'stale' });
    assert.deepEqual(texts('status'), [
      'Base Updated. The base changed its inputs, outputs or exits, so runs use the base until you bring this copy up to date.Compare'
    ]);
    assert.equal(
      screen.getByRole('link', { name: 'Compare' }).getAttribute('href'),
      '/?panel=compare'
    );
  });

  it('suggests comparing when the base has merely been updated', () => {
    notices({ base: 'updated', compareHref: '/w/1?panel=compare' });
    assert.deepEqual(texts('status'), [
      'Base Updated. The base has changed since this copy was made. Compare to see what changed.Compare'
    ]);
    assert.equal(
      screen.getByRole('link', { name: 'Compare' }).getAttribute('href'),
      '/w/1?panel=compare'
    );
  });

  it('tells how to override an empty system agency rule', () => {
    notices({ emptySlot: 'system' });
    assert.deepEqual(texts('status'), [
      'This Agency Rule does nothing yet: it hands its inputs straight back. Override it for your agency, then add nodes between Start and Return to change what it hands back.'
    ]);
  });

  it('tells how to fill an empty agency copy', () => {
    notices({ emptySlot: 'copy' });
    assert.deepEqual(texts('status'), [
      'This Agency Rule does nothing yet: it hands its inputs straight back. Add nodes between Start and Return to change what it hands back.'
    ]);
  });

  it('warns of every graph issue, then the documentation hints', () => {
    notices({
      issues: [{ message: 'No return' }, { message: 'No return' }],
      hints: ['Fix x']
    });
    assert.deepEqual(texts('status'), ['No return', 'No return', '1 Documentation HintFix x']);
  });
});
