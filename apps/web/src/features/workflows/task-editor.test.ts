import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { valueKinds } from '@ugula/catalog';
import type { Json } from '@ugula/graph';
import { createElement, useState } from 'react';
import { createCatalog } from '../../shared/graph/catalog.ts';
import { ValueKindsContext } from '../../shared/graph/pins.ts';
import { testNodes } from '../../shared/testing.ts';
import { render, screen, userEvent, within } from '../../shared/testing-dom.ts';
import {
  FieldsEditor,
  fieldsOf,
  outcomesOf,
  RecordFieldsEditor,
  TaskEditor,
  withOutcomes
} from './task-editor.tsx';

const task = {
  title: 'Match Payer',
  queue: 'billing',
  instructions: 'Pick the payer.',
  permission: 'payers:update',
  outcomes: ['matched', 'skip'],
  hints: { matched: 'Uses the payer you chose.' },
  fields: [
    { name: 'payer', type: 'string', required: ['matched'], options: ['A', 'B'] },
    { name: 'note', type: 'string' }
  ]
};

type Editor = typeof TaskEditor;

const Harness = ({
  editor,
  initial,
  sent,
  editable
}: {
  editor: Editor;
  initial: Json;
  sent: (Json | undefined)[];
  editable: boolean;
}) => {
  const [config, setConfig] = useState<Json | undefined>(initial);
  return createElement(
    ValueKindsContext.Provider,
    { value: valueKinds },
    createElement(editor, {
      nodeId: 't',
      config,
      editable,
      onConfig: (next) => {
        sent.push(next);
        setConfig(next);
      },
      def: {
        signature: { execIn: [], execOut: [], inputs: [], outputs: [] },
        variables: [],
        nodes: [],
        edges: []
      },
      catalog: createCatalog(testNodes)
    })
  );
};

const show = (initial: Json, { editor = TaskEditor, editable = true } = {}) => {
  const sent: (Json | undefined)[] = [];
  render(createElement(Harness, { editor, initial, sent, editable }));
  return { sent, last: () => sent.at(-1), user: userEvent.setup() };
};

type Scope = Pick<typeof screen, 'getByRole' | 'getAllByRole' | 'queryByRole'>;

const region = (name: string) => within(screen.getByRole('region', { name }));

const textbox = (scope: Scope, name: string, n = 0) =>
  scope.getAllByRole('textbox', { name })[n] as HTMLInputElement;

const shown = (scope: Scope, name: string, n = 0) =>
  scope.getAllByRole('button', { name })[n]?.textContent;

const option = (scope: Scope, list: string, name: string, n = 0) =>
  within(scope.getAllByRole('listbox', { name: list })[n] as HTMLElement).getByRole('option', {
    name
  });

describe('TaskEditor', () => {
  it('shows the task title, queue, instructions and who may complete it', () => {
    show(task);
    assert.equal(textbox(screen, 'Title').value, 'Match Payer');
    assert.equal(textbox(screen, 'Queue').value, 'billing');
    assert.equal(textbox(screen, 'Instructions').value, 'Pick the payer.');
    assert.equal(shown(screen, 'Who Can Complete It'), 'Change payers (payers:update)');
    assert.equal(shown(screen, 'Defaults Are'), 'Starting Values');
  });

  it('lets anyone in the queue complete a task with no permission set', () => {
    show({ outcomes: [] });
    assert.equal(shown(screen, 'Who Can Complete It'), 'Anyone in the Queue');
  });

  it('sends the title and queue as they are typed', async () => {
    const { last, user } = show({ title: 'A', queue: 'q' });
    await user.type(textbox(screen, 'Title'), 'B');
    assert.deepEqual(last(), { title: 'AB', queue: 'q' });
    await user.clear(textbox(screen, 'Queue'));
    assert.deepEqual(last(), { title: 'AB', queue: '' });
  });

  it('drops the instructions once they are cleared', async () => {
    const { last, user } = show({ title: 'A', instructions: 'x' });
    await user.clear(textbox(screen, 'Instructions'));
    assert.deepEqual(last(), { title: 'A' });
  });

  it('sets who may complete the task, and clears it for anyone in the queue', async () => {
    const { last, user } = show({ title: 'A' });
    await user.click(option(screen, 'Who Can Complete It', 'Change payers (payers:update)'));
    assert.deepEqual(last(), { title: 'A', permission: 'payers:update' });
    await user.click(option(screen, 'Who Can Complete It', 'Anyone in the Queue'));
    assert.deepEqual(last(), { title: 'A' });
  });

  it('starts the form from current values, and back from starting values', async () => {
    const { last, user } = show({ title: 'A' });
    await user.click(option(screen, 'Defaults Are', 'Current Values'));
    assert.deepEqual(last(), { title: 'A', prefill: 'current' });
    assert.equal(shown(screen, 'Defaults Are'), 'Current Values');
    await user.click(option(screen, 'Defaults Are', 'Starting Values'));
    assert.deepEqual(last(), { title: 'A' });
  });

  it('lists the outcomes with their hints', () => {
    show(task);
    const outcomes = region('Outcomes');
    assert.deepEqual(
      outcomes.getAllByRole('textbox', { name: 'Name' }).map((i) => (i as HTMLInputElement).value),
      ['matched', 'skip']
    );
    assert.deepEqual(
      outcomes.getAllByRole('textbox', { name: 'Hint' }).map((i) => (i as HTMLInputElement).value),
      ['Uses the payer you chose.', '']
    );
  });

  it('carries the hint and required fields over to a renamed outcome', async () => {
    const { last, user } = show(task);
    const name = textbox(region('Outcomes'), 'Name');
    await user.clear(name);
    await user.type(name, 'found');
    assert.deepEqual(last(), {
      ...task,
      outcomes: ['found', 'skip'],
      hints: { found: 'Uses the payer you chose.' },
      fields: [{ ...task.fields[0], required: ['found'] }, task.fields[1]]
    });
  });

  it('drops a removed outcome from the hints and required fields', async () => {
    const { last, user } = show(task);
    await user.click(screen.getByRole('button', { name: 'Remove matched' }));
    const { hints: _, ...rest } = task;
    assert.deepEqual(last(), {
      ...rest,
      outcomes: ['skip'],
      fields: [{ name: 'payer', type: 'string', options: ['A', 'B'] }, task.fields[1]]
    });
  });

  it('adds a numbered outcome', async () => {
    const { last, user } = show(task);
    await user.click(screen.getByRole('button', { name: 'Add Outcome' }));
    assert.deepEqual(last(), { ...task, outcomes: ['matched', 'skip', 'outcome3'] });
  });

  it('shows which outcomes need each field and its choices', () => {
    show(task);
    const fields = region('Fields');
    assert.deepEqual(
      fields.getAllByRole('textbox', { name: 'Name' }).map((i) => (i as HTMLInputElement).value),
      ['payer', 'note']
    );
    assert.equal(shown(fields, 'Required To', 0), 'matched');
    assert.equal(shown(fields, 'Required To', 1), 'Never Required');
    assert.deepEqual(
      fields.getAllByRole('textbox', { name: 'Value' }).map((i) => (i as HTMLInputElement).value),
      ['A', 'B']
    );
  });

  it('requires a field for more outcomes, and for none once all are unchosen', async () => {
    const { last, user } = show(task);
    const fields = region('Fields');
    await user.click(option(fields, 'Required To', 'skip'));
    assert.deepEqual(last(), {
      ...task,
      fields: [{ ...task.fields[0], required: ['matched', 'skip'] }, task.fields[1]]
    });
    await user.click(option(fields, 'Required To', 'skip'));
    await user.click(option(fields, 'Required To', 'matched'));
    assert.deepEqual(last(), {
      ...task,
      fields: [{ name: 'payer', type: 'string', options: ['A', 'B'] }, task.fields[1]]
    });
  });

  it('drops the choices once the last one is removed', async () => {
    const { last, user } = show(task);
    await user.click(screen.getByRole('button', { name: 'Remove A' }));
    await user.click(screen.getByRole('button', { name: 'Remove B' }));
    assert.deepEqual(last(), {
      ...task,
      fields: [{ name: 'payer', type: 'string', required: ['matched'] }, task.fields[1]]
    });
  });

  it('offers choices only for text fields', async () => {
    const { user } = show({ outcomes: ['done'], fields: [{ name: 'n', type: 'string' }] });
    assert.ok(screen.getByRole('button', { name: 'Add Choice' }));
    await user.click(option(region('Fields'), 'Type', 'Number'));
    assert.ok(!screen.queryByRole('button', { name: 'Add Choice' }));
  });

  it('adds a field with a free name', async () => {
    const { last, user } = show(task);
    await user.click(screen.getByRole('button', { name: 'Add Field' }));
    assert.deepEqual(last(), {
      ...task,
      fields: [...task.fields, { name: 'field3', type: 'string' }]
    });
  });

  it('locks every field and hides the list actions when read-only', () => {
    show(task, { editable: false });
    assert.equal(screen.getAllByRole('group')[0]?.hasAttribute('disabled'), true);
    for (const name of ['Add Outcome', 'Add Field', 'Add Choice', 'Remove matched']) {
      assert.equal(screen.queryByRole('button', { name }), null, name);
    }
  });
});

describe('FieldsEditor', () => {
  const edit = (fields: Json[]) => {
    const sent: Json[][] = [];
    const Fields = () => {
      const [value, setValue] = useState(fields);
      return createElement(
        ValueKindsContext.Provider,
        { value: valueKinds },
        createElement(FieldsEditor, {
          id: 'f',
          fields: fieldsOf(value),
          editable: true,
          onChange: (next) => {
            sent.push(next);
            setValue(next);
          }
        })
      );
    };
    render(createElement(Fields));
    return { last: () => sent.at(-1), user: userEvent.setup() };
  };

  it('edits a record field without the task-only parts', () => {
    edit([{ name: 'claimId', type: { id: 'claim' }, label: 'Claim' }]);
    assert.equal(textbox(screen, 'Name').value, 'claimId');
    assert.equal(textbox(screen, 'Label').value, 'Claim');
    assert.equal(shown(screen, 'Type'), 'Claim ID');
    assert.ok(!screen.queryByRole('button', { name: 'Required To' }));
    assert.ok(!screen.queryByRole('button', { name: 'Add Choice' }));
  });

  it('drops the label once it is cleared', async () => {
    const { last, user } = edit([{ name: 'a', type: 'string', label: 'A' }]);
    await user.clear(textbox(screen, 'Label'));
    assert.deepEqual(last(), [{ name: 'a', type: 'string' }]);
  });

  it('changes the type of a field', async () => {
    const { last, user } = edit([{ name: 'a', type: 'string' }]);
    await user.click(option(screen, 'Type', 'Number'));
    assert.deepEqual(last(), [{ name: 'a', type: 'number' }]);
  });

  it('reads a field with no type as text', () => {
    edit([{ name: 'a' }]);
    assert.equal(shown(screen, 'Type'), 'Text');
  });

  it('names a new field after the fields already taken', async () => {
    const { last, user } = edit([
      { name: 'field2', type: 'string' },
      { name: 'x', type: 'string' }
    ]);
    await user.click(screen.getByRole('button', { name: 'Add Field' }));
    assert.deepEqual(last(), [
      { name: 'field2', type: 'string' },
      { name: 'x', type: 'string' },
      { name: 'field3', type: 'string' }
    ]);
  });
});

describe('RecordFieldsEditor', () => {
  it('shows the record fields and sends edits to them', async () => {
    const { last, user } = show(
      { fields: [{ name: 'a', type: 'number' }] },
      { editor: RecordFieldsEditor }
    );
    assert.equal(shown(screen, 'Type'), 'Number');
    await user.type(textbox(screen, 'Name'), 'b');
    assert.deepEqual(last(), { fields: [{ name: 'ab', type: 'number' }] });
  });
});

describe('outcomesOf', () => {
  it('pairs each outcome with its hint, skipping non-text outcomes', () => {
    assert.deepEqual(outcomesOf({ outcomes: ['a', 1, 'b'], hints: { a: 'Hint', b: 2 } }), [
      { name: 'a', hint: 'Hint' },
      { name: 'b', hint: '' }
    ]);
    assert.deepEqual(outcomesOf({}), []);
  });
});

describe('withOutcomes', () => {
  const outcomes = outcomesOf(task);

  it('leaves required fields alone when outcomes are only reordered', () => {
    const moved = withOutcomes(task, [...outcomes].reverse());
    assert.deepEqual(moved.outcomes, ['skip', 'matched']);
    assert.deepEqual(fieldsOf(moved.fields)[0]?.required, ['matched']);
  });

  it('keeps the required fields when an outcome is added', () => {
    const added = withOutcomes(task, [...outcomes, { name: 'later', hint: '' }]);
    assert.deepEqual(added.fields, task.fields);
    assert.deepEqual(added.hints, task.hints);
  });

  it('adds no fields to a config that has none', () => {
    assert.deepEqual(withOutcomes({ outcomes: ['a'] }, [{ name: 'b', hint: '' }]), {
      outcomes: ['b']
    });
  });
});
