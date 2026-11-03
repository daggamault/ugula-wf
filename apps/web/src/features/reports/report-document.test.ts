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
          {
            label: 'Share',
            isNumeric: true,
            text: (r, t) => `${(r.n / (t.n ?? 1)) * 100}%`,
            csv: (r) => r.n
          }
        ],
        rows: [{ name: 'Medicare', n: 2 }],
        totals: { n: 4 },
        footer: ['Total', '100%']
      })
    );
    assert.ok(html.includes('<h2') && html.includes('Payer Performance'));
    assert.ok(html.includes('<th scope="col"') && html.includes('>Medicare<'));
    assert.ok(html.includes('>50%<'));
    assert.ok(html.includes('<tfoot>') && html.includes('>Total<'));
    assert.ok(html.includes('bg-white') && html.includes('text-black'));
    assert.ok(!/(primary|success|warning|danger|info)/.test(html));
  });

  it('sets numbers in tabular figures and leaves the footer out without totals', () => {
    const html = renderToStaticMarkup(
      createElement(ReportDocument<{ name: string; n: number }>, {
        title: 'Work Queue',
        details: [],
        columns: [
          { label: 'Name', text: (r) => r.name, csv: (r) => r.name },
          { label: 'Open', isNumeric: true, text: (r) => String(r.n), csv: (r) => r.n }
        ],
        rows: [{ name: 'Review', n: 3 }],
        totals: {},
        footer: null
      })
    );
    assert.equal(html.match(/tabular-nums/g)?.length, 2);
    assert.ok(html.includes('tabular-nums">3<') && !html.includes('tabular-nums">Review<'));
    assert.ok(!html.includes('<tfoot>'));
  });
});
