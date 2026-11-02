import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportDocument } from './report-document.tsx';

describe('ReportDocument', () => {
  it('prints a black and gray table with its details and totals', () => {
    const html = renderToStaticMarkup(
      createElement(ReportDocument<{ name: string; n: number }>, {
        title: 'Payer Performance',
        details: ['Dates of service', 'Run today'],
        columns: [
          { label: 'Payer', text: (r) => r.name, csv: (r) => r.name },
          { label: 'Claims', isNumeric: true, text: (r) => String(r.n), csv: (r) => r.n }
        ],
        rows: [{ name: 'Medicare', n: 2 }],
        totals: ['Total', '2']
      })
    );
    assert.ok(html.includes('<h2') && html.includes('Payer Performance'));
    assert.ok(html.includes('<th scope="col"') && html.includes('>Medicare<'));
    assert.ok(html.includes('<tfoot>') && html.includes('>Total<'));
    assert.ok(html.includes('bg-white') && html.includes('text-black'));
    assert.ok(!/(primary|success|warning|danger|info)/.test(html));
  });
});
