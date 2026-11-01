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
    assert.ok(html.includes('When the key is not listed') && html.includes('value="S"'));
    assert.ok(html.includes('Add row') && html.includes('aria-label="Remove 4221003"'));
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
    assert.ok(html.includes('What the rules check') && html.includes('What the rules decide'));
    assert.ok(html.includes('When Level of care'));
    assert.ok(html.includes('value="4232003, 4232005"'));
    assert.ok(html.includes('Then level') && html.includes('value="ALS1"'));
    assert.ok(html.includes('When no rule holds') && html.includes('value="BLS"'));
    assert.ok(html.includes('aria-label="Move ALS care up"'));
    assert.ok(
      html.includes('Add rule') && html.includes('Add input') && html.includes('Add output')
    );
    const locked = render(DecisionTableEditor, config, false);
    assert.ok(!locked.includes('Add rule') && locked.includes('disabled'));
  });
});
