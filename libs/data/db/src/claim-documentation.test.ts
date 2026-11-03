import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readDocumentation } from '@ugula/billing';
import { documentationOf, documentationValues } from './claim-documentation.ts';

describe('claim documentation columns', () => {
  it('round-trips documentation through its claim columns', () => {
    const doc = readDocumentation({
      signature: 'exception',
      signatureNote: 'Not signed because the patient was unconscious',
      pcsOnFile: true,
      pcsSignedOn: '2026-09-01',
      transportReason: 'A',
      conditionCodes: ['09', '06'],
      priorAuthorization: 'PA-1',
      weightKg: 81.6,
      atScene: '2026-09-14T12:05:00.000Z',
      leftScene: '2026-09-14T12:25:00.000Z',
      atDestination: null
    });
    const values = documentationValues(doc);
    const row = {
      ...values,
      weight_kg: String(values.weight_kg),
      at_scene_at: new Date(values.at_scene_at ?? ''),
      left_scene_at: new Date(values.left_scene_at ?? ''),
      at_destination_at: null
    };
    assert.deepEqual(documentationOf(row), doc);
  });

  it('reads missing weight and times as null', () => {
    const doc = readDocumentation({ signature: 'signed' });
    const row = {
      ...documentationValues(doc),
      weight_kg: null,
      at_scene_at: null,
      left_scene_at: null,
      at_destination_at: null
    };
    const read = documentationOf(row);
    assert.deepEqual(
      [read.weightKg, read.atScene, read.leftScene, read.atDestination],
      [null, null, null, null]
    );
    assert.deepEqual(read, doc);
  });
});
