import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement, useState } from 'react';
import { render, screen, userEvent, within } from '../testing-dom.ts';
import { matchesOf, runsOf, Select, SelectControl, summaryOf, typeaheadIndex } from './select.tsx';

const popoverOpen = new WeakSet<Element>();
const setPopover = (el: HTMLElement, isOpen: boolean) => {
  if (popoverOpen.has(el) === isOpen) return;
  if (isOpen) popoverOpen.add(el);
  else popoverOpen.delete(el);
  el.dispatchEvent(Object.assign(new Event('toggle'), { newState: isOpen ? 'open' : 'closed' }));
};
const nativeMatches = Element.prototype.matches;
Object.assign(HTMLElement.prototype, {
  showPopover(this: HTMLElement) {
    setPopover(this, true);
  },
  hidePopover(this: HTMLElement) {
    setPopover(this, false);
  }
});
Object.assign(Element.prototype, {
  matches(this: Element, selector: string) {
    return selector === ':popover-open'
      ? popoverOpen.has(this)
      : nativeMatches.call(this, selector);
  }
});
document.addEventListener('click', (e) => {
  const trigger = e.target instanceof Element ? e.target.closest('button[popovertarget]') : null;
  const panel = trigger && document.getElementById(trigger.getAttribute('popovertarget') ?? '');
  if (panel) setPopover(panel, !popoverOpen.has(panel));
});
document.addEventListener('keydown', (e) => {
  const panel = e.key === 'Escape' && e.target instanceof Element && e.target.closest('[popover]');
  if (panel instanceof HTMLElement) setPopover(panel, false);
});

type Props = Parameters<typeof SelectControl>[0];
type Picked = string | string[];

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' }
];

const many = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ value: String(i), label: `Option ${i}` }));

const noop = () => undefined;

const renderSelect = (props: Partial<Props> = {}) => {
  const changes: Picked[] = [];
  const Host = () => {
    const [value, setValue] = useState<Picked>(
      (props.value as Picked | undefined) ?? (props.isMultiple ? [] : '')
    );
    return createElement(SelectControl, {
      'aria-label': 'Kind',
      options: OPTIONS,
      ...props,
      value,
      onChange: (next: Picked) => {
        changes.push(next);
        setValue(next);
      }
    } as Props);
  };
  render(createElement(Host));
  const trigger = screen.getByRole('button', { name: 'Kind' });
  const activeLabel = () => {
    const owner = screen.queryByRole('combobox') ?? screen.getByRole('listbox');
    const id = owner.getAttribute('aria-activedescendant');
    return id ? document.getElementById(id)?.textContent : undefined;
  };
  return { changes, trigger, user: userEvent.setup(), activeLabel };
};

const formEntries = (form: HTMLFormElement | null) => [
  ...new FormData(form ?? undefined).entries()
];

describe('summaryOf', () => {
  it('shows nothing, one label or the first label and a count', () => {
    assert.equal(summaryOf(OPTIONS, []), null);
    assert.equal(summaryOf(OPTIONS, ['b']), 'Beta');
    assert.equal(summaryOf(OPTIONS, ['a', 'c']), 'Alpha +1');
    assert.equal(summaryOf(OPTIONS, ['a', 'b', 'c']), 'Alpha +2');
  });

  it('ignores values with no option', () => {
    assert.equal(summaryOf(OPTIONS, ['x']), null);
    assert.equal(summaryOf(OPTIONS, ['x', 'b']), 'Beta');
  });
});

describe('matchesOf', () => {
  it('keeps every option for a blank query', () => {
    assert.deepEqual(matchesOf(OPTIONS, ''), OPTIONS);
    assert.deepEqual(matchesOf(OPTIONS, '   '), OPTIONS);
  });

  it('matches labels case-insensitively anywhere in the label', () => {
    assert.deepEqual(
      matchesOf(OPTIONS, ' MM ').map((o) => o.value),
      ['c']
    );
    assert.deepEqual(
      matchesOf(OPTIONS, 'a').map((o) => o.value),
      ['a', 'b', 'c']
    );
    assert.deepEqual(matchesOf(OPTIONS, 'zeta'), []);
  });
});

describe('runsOf', () => {
  it('groups neighbouring options that share a group, keeping their places', () => {
    assert.deepEqual(
      runsOf([
        { value: 'a', label: 'A', group: 'X' },
        { value: 'b', label: 'B', group: 'X' },
        { value: 'c', label: 'C' },
        { value: 'd', label: 'D', group: 'X' }
      ]).map((r) => [r.group, r.items.map((x) => x.i)]),
      [
        ['X', [0, 1]],
        [undefined, [2]],
        ['X', [3]]
      ]
    );
  });
});

describe('typeaheadIndex', () => {
  const options = ['All', 'Failed', 'Faulted', 'Running'].map((label) => ({ value: label, label }));

  it('matches what was typed as a prefix, starting at the active option', () => {
    assert.equal(typeaheadIndex(options, 'fau', 0), 2);
    assert.equal(typeaheadIndex(options, 'fa', 1), 1);
    assert.equal(typeaheadIndex(options, 'x', 0), -1);
  });

  it('cycles through options sharing a letter when the letter repeats', () => {
    assert.equal(typeaheadIndex(options, 'f', 1), 2);
    assert.equal(typeaheadIndex(options, 'ff', 2), 1);
  });
});

describe('Select', () => {
  it('names the trigger by its label and shows the chosen option', () => {
    render(
      createElement(Select, {
        id: 'kind',
        label: 'Kind',
        options: OPTIONS,
        value: 'b',
        onChange: noop
      })
    );
    const trigger = screen.getByRole('button', { name: 'Kind' });
    assert.equal(trigger.textContent, 'Beta');
    assert.equal(trigger.getAttribute('aria-haspopup'), 'listbox');
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(trigger.getAttribute('aria-invalid'), null);
    assert.equal(
      screen.getByRole('listbox', { name: 'Kind' }).getAttribute('aria-multiselectable'),
      null
    );
    assert.deepEqual(
      screen.getAllByRole('option', { selected: true }).map((o) => o.textContent),
      ['Beta']
    );
  });

  it('heads each group of options once, and finds options by their group', () => {
    const grouped = [
      { value: 'a', label: 'Text', group: 'Basics' },
      { value: 'b', label: 'Number', group: 'Basics' },
      { value: 'c', label: 'Claim', group: 'Records' }
    ];
    render(
      createElement(Select, {
        id: 'kind',
        label: 'Kind',
        options: grouped,
        value: 'a',
        onChange: noop
      })
    );
    const list = screen.getByRole('listbox', { name: 'Kind' });
    assert.deepEqual(
      within(list)
        .getAllByRole('group')
        .map((g) => [
          g.getAttribute('aria-label') ?? g.querySelector('legend')?.textContent,
          within(g)
            .getAllByRole('option')
            .map((o) => o.textContent)
        ]),
      [
        ['Basics', ['Text', 'Number']],
        ['Records', ['Claim']]
      ]
    );
    assert.ok(within(list).getByRole('group', { name: 'Records' }));
    assert.deepEqual(
      matchesOf(grouped, 'record').map((o) => o.value),
      ['c']
    );
  });

  it('shows the placeholder until a value is chosen', () => {
    render(
      createElement(Select, {
        id: 'kind',
        label: 'Kind',
        placeholder: 'Choose a kind',
        options: OPTIONS,
        value: '',
        onChange: noop
      })
    );
    assert.equal(screen.getByRole('button', { name: 'Kind' }).textContent, 'Choose a kind');
    assert.equal(screen.queryAllByRole('option', { selected: true }).length, 0);
  });

  it('marks the trigger invalid and describes it by the error', () => {
    render(
      createElement(Select, {
        id: 'payer',
        label: 'Payer',
        error: 'Pick one',
        options: [],
        value: '',
        onChange: noop
      })
    );
    const trigger = screen.getByRole('button', { name: 'Payer' });
    assert.equal(trigger.getAttribute('aria-invalid'), 'true');
    assert.equal(
      document.getElementById(trigger.getAttribute('aria-describedby') ?? '')?.textContent,
      'Pick one'
    );
    assert.equal(screen.getByRole('status').textContent, 'No matches');
  });

  it('submits with its form only when named, sending a blank choice like a native select', () => {
    const submitted = (props: { name?: string; value: string }) => {
      const { container, unmount } = render(
        createElement(
          'form',
          null,
          createElement(Select, {
            id: 'k',
            label: 'K',
            options: [{ value: '', label: 'Any' }, ...OPTIONS],
            onChange: noop,
            ...props
          })
        )
      );
      const entries = formEntries(container.querySelector('form'));
      unmount();
      return entries;
    };
    assert.deepEqual(submitted({ name: 'kind', value: 'c' }), [['kind', 'c']]);
    assert.deepEqual(submitted({ name: 'kind', value: '' }), [['kind', '']]);
    assert.deepEqual(submitted({ value: 'c' }), []);
  });
});

describe('SelectControl', () => {
  it('opens on click with the chosen option active and focus in the list', async () => {
    const { trigger, user, activeLabel } = renderSelect({ value: 'b' });
    await user.click(trigger);
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.ok(document.activeElement === screen.getByRole('listbox', { name: 'Kind' }));
    assert.equal(activeLabel(), 'Beta');
  });

  it('opens from the trigger with the arrow keys', async () => {
    const { trigger, user } = renderSelect();
    trigger.focus();
    await user.keyboard('{ArrowUp}');
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  });

  it('moves the active option with the arrow keys, Home and End, stopping at the ends', async () => {
    const { trigger, user, activeLabel } = renderSelect({ value: 'a' });
    await user.click(trigger);
    await user.keyboard('{ArrowUp}');
    assert.equal(activeLabel(), 'Alpha');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    assert.equal(activeLabel(), 'Gamma');
    await user.keyboard('{Home}');
    assert.equal(activeLabel(), 'Alpha');
    await user.keyboard('{End}');
    assert.equal(activeLabel(), 'Gamma');
  });

  it('chooses the active option with Enter or Space, closes and returns focus', async () => {
    const { trigger, user, changes } = renderSelect({ value: 'a' });
    await user.click(trigger);
    await user.keyboard('{ArrowDown}{Enter}');
    assert.deepEqual(changes, ['b']);
    assert.equal(trigger.textContent, 'Beta');
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.ok(document.activeElement === trigger);
    await user.click(trigger);
    await user.keyboard('{ArrowDown}[Space]');
    assert.deepEqual(changes, ['b', 'c']);
  });

  it('chooses an option by clicking it', async () => {
    const { trigger, user, changes } = renderSelect();
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: 'Gamma' }));
    assert.deepEqual(changes, ['c']);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  });

  it('closes without a change when the chosen option is picked again', async () => {
    const { trigger, user, changes } = renderSelect({ value: 'b' });
    await user.click(trigger);
    await user.keyboard('{Enter}');
    assert.deepEqual(changes, []);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  });

  it('jumps to the option whose label starts with what was typed', async () => {
    const options = ['Alpha', 'Beta', 'Bravo', 'Gamma'].map((label) => ({ value: label, label }));
    const { trigger, user, activeLabel } = renderSelect({ options, value: 'Alpha' });
    await user.click(trigger);
    await user.keyboard('br');
    assert.equal(activeLabel(), 'Bravo');
  });

  it('cycles through options sharing a first letter while that letter repeats', async () => {
    const options = ['Alpha', 'Beta', 'Bravo', 'Gamma'].map((label) => ({ value: label, label }));
    const { trigger, user, activeLabel } = renderSelect({ options, value: 'Alpha' });
    await user.click(trigger);
    await user.keyboard('b');
    assert.equal(activeLabel(), 'Beta');
    await user.keyboard('b');
    assert.equal(activeLabel(), 'Bravo');
    await user.keyboard('b');
    assert.equal(activeLabel(), 'Beta');
  });

  it('keeps the active option when nothing starts with what was typed', async () => {
    const options = ['Alpha', 'Beta', 'Bravo', 'Gamma'].map((label) => ({ value: label, label }));
    const { trigger, user, activeLabel } = renderSelect({ options, value: 'Alpha' });
    await user.click(trigger);
    await user.keyboard('g');
    assert.equal(activeLabel(), 'Gamma');
    await user.keyboard('b');
    assert.equal(activeLabel(), 'Gamma');
  });

  it('closes when Tab or a click elsewhere moves focus out', async () => {
    const outside = document.body.appendChild(document.createElement('button'));
    const { trigger, user, changes } = renderSelect();
    await user.click(trigger);
    await user.keyboard('{Tab}');
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    await user.click(trigger);
    await user.click(outside);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.deepEqual(changes, []);
    outside.remove();
  });

  it('cannot be opened while disabled', async () => {
    const { trigger, user } = renderSelect({ disabled: true });
    await user.click(trigger);
    assert.equal((trigger as HTMLButtonElement).disabled, true);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  });

  it('toggles several values and stays open while choosing', async () => {
    const { trigger, user, changes } = renderSelect({ isMultiple: true, value: ['a'] });
    assert.equal(screen.getByRole('listbox').getAttribute('aria-multiselectable'), 'true');
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: 'Gamma' }));
    await user.keyboard('{Home}{Enter}');
    assert.deepEqual(changes, [['a', 'c'], ['c']]);
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(trigger.textContent, 'Gamma');
  });

  it('summarises several values and submits each one', () => {
    const { container } = render(
      createElement(
        'form',
        null,
        createElement(SelectControl, {
          'aria-label': 'Tags',
          isMultiple: true,
          name: 'tags',
          options: OPTIONS,
          value: ['a', 'c'],
          onChange: noop
        })
      )
    );
    assert.equal(screen.getByRole('button', { name: 'Tags' }).textContent, 'Alpha +1');
    assert.deepEqual(formEntries(container.querySelector('form')), [
      ['tags', 'a'],
      ['tags', 'c']
    ]);
  });

  it('adds a search box only past seven options or when asked', () => {
    const isSearchable = (props: Partial<Props>) => {
      const { unmount } = render(
        createElement(SelectControl, {
          'aria-label': 'Pick',
          options: OPTIONS,
          value: '',
          onChange: noop,
          ...props
        } as Props)
      );
      const box = screen.queryByRole('combobox', { name: 'Search Pick' });
      unmount();
      return box !== null;
    };
    assert.equal(isSearchable({ options: many(7) }), false);
    assert.equal(isSearchable({ options: many(8) }), true);
    assert.equal(isSearchable({ isSearchable: true }), true);
    assert.equal(isSearchable({ options: many(8), isSearchable: false }), false);
  });

  it('filters by the search box and chooses the first match with Enter', async () => {
    const { trigger, user, changes, activeLabel } = renderSelect({ options: many(10) });
    await user.click(trigger);
    assert.ok(document.activeElement === screen.getByRole('combobox', { name: 'Search Kind' }));
    await user.keyboard('9');
    assert.deepEqual(
      screen.getAllByRole('option').map((o) => o.textContent),
      ['Option 9']
    );
    assert.equal(activeLabel(), 'Option 9');
    await user.keyboard('{Enter}');
    assert.deepEqual(changes, ['9']);
    assert.ok(document.activeElement === trigger);
  });

  it('types letters into the search box instead of jumping, and says when nothing matches', async () => {
    const { trigger, user, changes } = renderSelect({ options: many(10) });
    await user.click(trigger);
    await user.keyboard('o z');
    assert.equal((screen.getByRole('combobox') as HTMLInputElement).value, 'o z');
    assert.equal(screen.queryAllByRole('option').length, 0);
    assert.equal(screen.getByRole('status').textContent, 'No matches');
    await user.keyboard('{Enter}');
    assert.deepEqual(changes, []);
  });

  it('starts each opening with an empty search', async () => {
    const { trigger, user } = renderSelect({ options: many(10) });
    await user.click(trigger);
    await user.keyboard('9{Escape}');
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    await user.click(trigger);
    assert.equal((screen.getByRole('combobox') as HTMLInputElement).value, '');
    assert.equal(screen.getAllByRole('option').length, 10);
  });

  it('asks the server to search, showing every option it returns and a result count', async () => {
    const searches: string[] = [];
    const { trigger, user } = renderSelect({
      options: many(3),
      onSearch: (q) => searches.push(q),
      emptyText: 'Type a code'
    });
    await user.click(trigger);
    await user.keyboard('zz');
    assert.deepEqual(searches, ['', 'z', 'zz']);
    assert.equal(screen.getAllByRole('option').length, 3);
    assert.equal(screen.getByRole('status').textContent, '3 results');
  });

  it('says why a server search has nothing to show', () => {
    render(
      createElement(SelectControl, {
        'aria-label': 'Code',
        options: [],
        value: '',
        onChange: noop,
        onSearch: noop,
        emptyText: 'Type a code or words from its description'
      })
    );
    assert.equal(
      screen.getByRole('status').textContent,
      'Type a code or words from its description'
    );
  });
});
