import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLAIM, ENCOUNTER_FACTS } from './claim-models.ts';
import { billingModels } from './models.ts';
import { X837_CLAIM } from './submission-models.ts';

describe('billingModels', () => {
  it('declares unique, labelled models for claims and 837P claims', () => {
    assert.equal(new Set(billingModels.map((m) => m.key)).size, billingModels.length);
    assert.deepEqual(
      billingModels.flatMap((m) =>
        m.fields
          .filter((f) => !f.label || !/^[a-z]\w*$/i.test(f.name))
          .map((f) => `${m.key}.${f.name}`)
      ),
      []
    );
    assert.deepEqual(
      Object.keys((CLAIM.type as { object: object }).object),
      CLAIM.fields.map((f) => f.name)
    );
    assert.equal(X837_CLAIM.category, 'X12 837P');
    assert.equal('type' in (billingModels[0] ?? {}), false);
  });

  it('gathers the encounter facts every rule reads into sections', () => {
    assert.deepEqual(
      ENCOUNTER_FACTS.fields.map((f) => f.name),
      ['trip', 'locations', 'patient', 'clinical', 'documentation', 'coverages', 'paymentMethod']
    );
    const keys = new Set(billingModels.map((m) => m.key));
    assert.deepEqual(
      ['billing.check-facts', 'billing.claim-ledger', 'billing.remittance-line'].filter(
        (k) => !keys.has(k)
      ),
      []
    );
  });
});
