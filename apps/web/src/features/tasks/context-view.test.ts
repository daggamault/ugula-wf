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
    assert.ok(html.includes('Show Raw Data'));
  });

  it('shows claim issues, warnings, notes, report changes and the full claim check', () => {
    const html = renderToStaticMarkup(
      createElement(ContextView, {
        label: 'Task context',
        value: {
          issues: [
            {
              code: 'diagnosis-missing',
              severity: 'blocking',
              field: 'diagnoses',
              message: 'No diagnosis',
              coverageId: null
            }
          ],
          warnings: ['The narrative could not be read'],
          notes: ['Suggested by the model'],
          changes: [{ field: 'Birth date', was: '1958-04-12', now: '1958-04-21' }],
          claim: {
            claimId: CLAIM,
            issues: [
              {
                code: 'diagnosis-missing',
                severity: 'blocking',
                field: 'diagnoses',
                message: 'No diagnosis',
                coverageId: null
              }
            ],
            claim: {
              patientId: 'p1',
              patient: { addressLine: '1 Main St', city: 'Town', state: 'VT', postalCode: '05401' },
              pcrNumber: 'PCR-1',
              classification: 'emergency',
              level: 'ALS1',
              emergency: true,
              loadedMiles: 6.8,
              lines: [{ code: 'A0427', units: 1, unitCents: 90_000, totalCents: 90_000 }],
              totalCents: 90_000,
              payers: [
                {
                  coverageId: 'c1',
                  name: 'Medicare',
                  payerId: 'd1',
                  claimFiling: 'MB',
                  memberId: 'M1',
                  relationship: '01',
                  insuredFirstName: 'John',
                  insuredLastName: 'Doe'
                }
              ],
              details: {
                serviceDate: '2026-10-01',
                pickup: {
                  name: null,
                  addressLine: null,
                  city: 'Town',
                  state: 'VT',
                  postalCode: null
                },
                destination: {
                  name: 'General',
                  addressLine: null,
                  city: null,
                  state: null,
                  postalCode: null
                },
                diagnoses: ['R07.9'],
                originDestination: 'RH'
              }
            }
          }
        }
      })
    );
    assert.equal(html.split('Show Raw Data')[0]?.split('No diagnosis').length, 2);
    assert.ok(html.includes('Diagnoses: </span>No diagnosis'));
    assert.ok(html.includes('Warnings') && html.includes('The narrative could not be read'));
    assert.ok(html.includes('bg-info/10') && html.includes('Suggested by the model'));
    assert.ok(html.includes('Birth date') && html.includes('Apr 21, 1958'));
    assert.ok(html.includes('Emergency Transport') && html.includes('A0427'));
    assert.ok(html.includes('$900.00') && html.includes('Spouse') && html.includes('John Doe'));
    assert.ok(html.includes('1 Main St, Town, VT 05401'));
    assert.ok(html.includes(`href="/claims/${CLAIM}"`));
  });

  it('shows nothing for an empty context', () => {
    assert.equal(renderToStaticMarkup(createElement(ContextView, { label: 'x', value: null })), '');
    const blank = renderToStaticMarkup(
      createElement(ContextView, { label: 'x', value: { a: '', b: [] } })
    );
    assert.ok(!blank.includes('<dl') && blank.includes('Show Raw Data'));
  });

  it('shows a plain value as text with the raw data behind it', () => {
    const html = renderToStaticMarkup(
      createElement(ContextView, { label: 'Resolution', value: false })
    );
    assert.ok(html.includes('<p class="text-sm">No</p>') && html.includes('Show Raw Data'));
  });

  it('links runs and tasks, formats numbers and says when nothing changed', () => {
    const html = renderToStaticMarkup(
      createElement(ContextView, {
        label: 'Task context',
        value: { runId: CLAIM, taskId: CLAIM, attempts: 12_345, changes: [] }
      })
    );
    assert.ok(html.includes(`href="/runs/${CLAIM}"`) && html.includes('Open Run'));
    assert.ok(html.includes(`href="/tasks/${CLAIM}"`) && html.includes('Open Task'));
    assert.ok(html.includes((12_345).toLocaleString()));
    assert.ok(html.includes('Nothing billed from the report changed.'));
    assert.ok(html.includes('aria-label="Task context"'));
  });
});
