import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DecisionTableEditor, LookupTableEditor } from './table-editors.tsx';

const render = (editor: typeof LookupTableEditor, config: unknown, editable = true) =>
  renderToStaticMarkup(
    createElement(editor, {
      nodeId: 'n1',
      config: config as never,
      editable,
      onConfig: () => undefined
    })
  );

describe('table editors', () => {
  it('edits lookup rows and the fallback as fields', () => {
    const html = render(LookupTableEditor, {
      rows: [{ key: '4221003', value: 'H' }],
      fallback: 'S'
    });
    assert.ok(html.includes('value="4221003"') && html.includes('value="H"'));
    assert.ok(html.includes('When the Key Is Not Listed') && html.includes('value="S"'));
    assert.ok(html.includes('Add Row') && html.includes('aria-label="Remove 4221003"'));
  });

  it('reorders rules with arrow buttons that name the rule and carry a tooltip', () => {
    const html = render(DecisionTableEditor, {
      inputs: [],
      outputs: [],
      rules: [
        { label: 'First', when: {}, set: {} },
        { label: '', when: {}, set: {} }
      ]
    });
    assert.ok(html.includes('aria-label="Move First down"') && html.includes('>Move Down<'));
    assert.ok(html.includes('aria-label="Move rule 2 up"') && html.includes('>Move Up<'));
  });

  it('hints how to type list and true or false lookup values', () => {
    const list = render(LookupTableEditor, {
      type: { list: 'string' },
      rows: [{ key: '', value: ['a', 'b'] }]
    });
    assert.ok(list.includes('value="a, b"') && list.includes('Separate items with commas.'));
    assert.ok(list.includes('aria-label="Remove row"'));
    assert.ok(list.includes('<option value="list" selected="">List of Text</option>'));
    assert.ok(
      render(LookupTableEditor, { type: 'boolean', rows: [{ key: 'k', value: true }] }).includes(
        'true or false.'
      )
    );
  });

  it('edits columns, ordered rules and the otherwise values of a decision table', () => {
    const config = {
      inputs: [{ name: 'care', type: 'string', label: 'Level of care' }],
      outputs: [{ name: 'level', type: 'string' }],
      rules: [
        {
          label: 'ALS care',
          when: { care: { op: 'oneOf', value: ['4232003', '4232005'] } },
          set: { level: 'ALS1' }
        }
      ],
      otherwise: { level: 'BLS' }
    };
    const html = render(DecisionTableEditor, config);
    assert.ok(html.includes('What the Rules Check') && html.includes('What the Rules Decide'));
    assert.ok(html.includes('When Level of Care'));
    assert.ok(html.includes('value="4232003, 4232005"'));
    assert.ok(html.includes('Then Level') && html.includes('value="ALS1"'));
    assert.ok(html.includes('When No Rule Holds') && html.includes('value="BLS"'));
    assert.ok(html.includes('aria-label="Move ALS care up"'));
    assert.ok(html.includes('Already first.') && html.includes('Already last.'));
    assert.ok(
      html.includes('aria-label="Remove input care"') &&
        html.includes('aria-label="Remove ALS care"')
    );
    assert.ok(
      html.includes('Add Rule') && html.includes('Add Input') && html.includes('Add Output')
    );
    const locked = render(DecisionTableEditor, config, false);
    assert.ok(!locked.includes('Add Rule') && locked.includes('disabled'));
  });
});
