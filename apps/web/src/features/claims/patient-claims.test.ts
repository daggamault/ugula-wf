import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import type { ClaimsClient } from './client.ts';
import { PatientClaims } from './patient-claims.tsx';

describe('PatientClaims', () => {
  it('lists every claim for the patient in a titled section while it loads', () => {
    const asked: unknown[] = [];
    const client = {
      list: (query: unknown) => {
        asked.push(query);
        return new Promise(() => undefined);
      }
    } as unknown as Pick<ClaimsClient, 'list'>;
    const html = renderToStaticMarkup(
      createElement(PatientClaims, { client, live: idleLive, patientId: 'p1' })
    );
    assert.ok(html.includes('>Claims</h2>'));
    assert.ok(html.includes('aria-label="Loading"'));
    assert.deepEqual(asked, []);
  });
});
