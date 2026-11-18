import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LiveEvent } from '@ugula/live';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClaimDetail } from '../../shared/claims/claim-detail.ts';
import { claimDetail as claim } from '../../shared/claims/testing.ts';
import type { Live } from '../../shared/live.ts';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, waitFor } from '../../shared/testing-dom.ts';
import { ClaimPage, type ClaimTab, ClaimView } from './claim-page.tsx';
import type { ClaimsClient } from './client.ts';

const renderView = (over: Partial<ClaimDetail> = {}, tab: ClaimTab = 'overview') =>
  renderToStaticMarkup(createElement(ClaimView, { claim: { ...claim, ...over }, codes: {}, tab }));

describe('ClaimView', () => {
  it('shows the claim for review: decisions, reasons, encounter, lines and ordered payers', () => {
    const html = renderView();
    assert.ok(html.includes('Needs Review'));
    assert.ok(html.includes('Doe, Jane'));
    assert.ok(html.includes('Claim 20261001-0012') && html.includes('Patient 20260915-0003'));
    assert.ok(html.includes('20261001-0007') && html.includes('PCR-1001'));
    assert.ok(!html.includes('Encounter 20261001-0007') && !html.includes('PCR PCR-1001'));
    assert.ok(html.includes('Emergency Transport') && html.includes('12.4 miles'));
    assert.ok(html.includes('Emergency response') && html.includes('Pt found sitting.'));
    assert.ok(html.includes('href="/imports/i1"') && html.includes('href="/patients/p1"'));
    assert.ok(html.includes('A0427') && html.includes('>RH<'));
    assert.ok(html.includes('1. </span>Medicare') && html.includes('2. </span>Blue Plan'));
    assert.equal(html.match(/Not in Payer Directory/g)?.length, 1);
    assert.ok(html.includes('href="/claims/c1?tab=data"'));
  });

  it('lists what the claim lacks to be sent, and nothing when it is ready', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimView, {
        claim,
        codes: {},
        issues: ['The first payer, Medicare, has no member ID']
      })
    );
    assert.ok(html.includes('Not ready to send'));
    assert.ok(html.includes('<li>The first payer, Medicare, has no member ID</li>'));
    assert.ok(!renderView().includes('Not ready to send'));
  });

  it('leaves out a patient number the patient does not have', () => {
    const html = renderView({ patient_number: null });
    assert.ok(!html.includes('Patient 2'));
  });

  it('shows the claim data read only on its tab, with no form anywhere', () => {
    const data = renderView({}, 'data');
    assert.ok(data.includes('Date of Service') && data.includes('R07.9') && data.includes('I10'));
    assert.ok(data.includes('1 Main St, Springfield, IL 62704') && data.includes('Apr 12, 1958'));
    for (const tab of ['overview', 'data'] as const) {
      assert.ok(!/<form|<input|<select|<textarea|<fieldset/.test(renderView({}, tab)), tab);
    }
  });
});

const fakeClaims = (find: ClaimsClient['find']): ClaimsClient => ({
  list: () => new Promise(() => undefined),
  find
});

const shown = () => screen.findByRole('heading', { name: 'Claim 20261001-0012' });

describe('ClaimPage', () => {
  it('loads the claim and says why it could not', async () => {
    render(
      createElement(ClaimPage, {
        client: fakeClaims(async () => ({ claim, codes: {}, issues: [] })),
        live: idleLive,
        claimId: 'c1'
      })
    );
    assert.ok(await shown());
  });

  it('says why the claim could not load', async () => {
    render(
      createElement(ClaimPage, {
        client: fakeClaims(async () => {
          throw new Error('Claim not found');
        }),
        live: idleLive,
        claimId: 'c1'
      })
    );
    assert.ok(await screen.findByRole('heading', { name: 'Something Went Wrong' }));
    assert.ok(screen.getByText('Claim not found'));
  });

  it('reloads when the claim changes, and not otherwise', async () => {
    const listeners: ((e: LiveEvent | null) => void)[] = [];
    const live: Live = {
      ...idleLive,
      subscribe: (listener) => {
        listeners.push(listener);
        return () => undefined;
      }
    };
    let finds = 0;
    render(
      createElement(ClaimPage, {
        client: fakeClaims(async () => {
          finds += 1;
          return { claim, codes: {}, issues: [] };
        }),
        live,
        claimId: 'c1'
      })
    );
    await shown();
    const emit = (e: LiveEvent) => {
      for (const listener of listeners) listener(e);
    };
    emit({ kind: 'claim', id: 'c2' });
    emit({ kind: 'task', id: 't2', runId: null });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(finds, 1);
    emit({ kind: 'claim', id: 'c1' });
    await waitFor(() => assert.equal(finds, 2));
  });
});
