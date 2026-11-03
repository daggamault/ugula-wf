import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContextView, labelOf } from './context-view.tsx';

const CLAIM = '01a169fa-2534-79ed-97b7-d7789e899bd6';

describe('ContextView', () => {
  it('turns keys into labels', () => {
    assert.equal(labelOf('loadedMiles'), 'Loaded Miles');
    assert.equal(labelOf('pcrNumber'), 'PCR Number');
    assert.equal(labelOf('balanceCents'), 'Balance');
    assert.equal(labelOf('memberId'), 'Member ID');
  });

  it('renders sections, cards and readable values, hiding internal ids', () => {
    const html = renderToStaticMarkup(
      createElement(ContextView, {
        label: 'Task context',
        value: {
          claimId: CLAIM,
          coverageId: '01a169fa-0000-7000-8000-000000000000',
          balanceCents: 123_456,
          patient: { name: 'Jane Doe', birthDate: '1958-04-12', notes: null },
          suggested: { emergency: true, loadedMiles: 6.8 },
          coverage: [
            { order: 'Primary', payer: 'Medicare' },
            { order: 'Secondary', payer: 'Blue Plan' }
          ],
          impressions: ['I10', 'Z74.09']
        }
      })
    );
    const text = html.replace(/<[^>]+>/g, ' ');
    assert.ok(html.includes(`href="/claims/${CLAIM}"`));
    assert.ok(!html.includes('>Coverage ID<'));
    assert.ok(html.includes('$1,234.56'));
    assert.ok(html.includes('>Patient</h3>'));
    assert.ok(html.includes('Jane Doe'));
    assert.ok(!html.includes('>Notes<'));
    assert.ok(html.includes('>Yes<'));
    assert.match(text, /Coverage\s+\(2\)/);
    assert.ok(html.includes('Blue Plan'));
    assert.ok(html.replace(/<[^>]+>/g, '').includes('I10, Z74.09'));
    assert.ok(html.includes('Show raw data'));
  });

  it('shows nothing for an empty context', () => {
    assert.equal(renderToStaticMarkup(createElement(ContextView, { label: 'x', value: null })), '');
  });
});
