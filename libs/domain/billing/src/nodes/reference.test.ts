import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Values } from '@ugula/graph';
import { invokeNode } from '@ugula/graph/testing';
import type { Hospital } from '../facilities.ts';
import { billingStores } from '../testing.ts';
import { referenceNodes } from './reference.ts';
import type { ReferenceStore } from './stores.ts';

const hospital: Hospital = {
  ccn: '010001',
  name: 'SOUTHEAST HEALTH MEDICAL CENTER',
  addressLine: '1108 ROSS CLARK CIRCLE',
  city: 'DOTHAN',
  state: 'AL',
  postalCode: '36301',
  phone: '3347938701',
  hospitalType: 'Acute Care Hospitals',
  emergencyServices: true,
  similarity: 1
};

const setup = () => {
  const calls: unknown[][] = [];
  const reference: ReferenceStore = {
    findCode: async (set, code) => {
      calls.push(['code', set, code]);
      return code === 'R07' ? { description: 'Pain in throat and chest', billable: false } : null;
    },
    medicareLocality: async (zip) => {
      calls.push(['locality', zip]);
      return zip.startsWith('99501')
        ? {
            carrier: '02102',
            locality: '01',
            rurality: 'urban',
            plusFourNeeded: false
          }
        : null;
    },
    medicareFees: async (year, carrier, locality, codes) => {
      calls.push(['fees', year, carrier, locality, codes]);
      return [
        {
          code: 'A0427',
          urbanCents: 70_975,
          ruralCents: 71_671,
          superRuralCents: 87_869,
          ruralShortTripCents: null
        }
      ];
    },
    zipPlace: async (zip) => {
      calls.push(['place', zip]);
      return zip === '36301'
        ? {
            postalCode: '36301',
            city: 'Dothan',
            state: 'AL',
            county: 'Houston',
            countyFips: '01069',
            latitude: 31.1429,
            longitude: -85.4022
          }
        : null;
    },
    findHospital: async (name, state, zip) => {
      calls.push(['hospital', name, state, zip]);
      return name.includes('Southeast') ? hospital : null;
    }
  };
  const nodes = referenceNodes(() => billingStores({ reference }));
  const run = (type: string, inputs: Values) => {
    const node = nodes.find((n) => n.type === `billing.${type}`);
    if (!node) throw new Error(`No node ${type}`);
    return invokeNode(node, { inputs });
  };
  return { calls, run };
};

describe('referenceNodes', () => {
  it('finds a code in a set, normalizing ICD-10 dots, and refuses an unknown set', async () => {
    const { calls, run } = setup();
    assert.deepEqual((await run('find-code', { codeSet: 'icd10cm', code: ' r07 ' })).outputs, {
      description: 'Pain in throat and chest',
      billable: false
    });
    const missing = await run('find-code', { codeSet: 'icd10cm', code: 'R07.9' });
    assert.deepEqual(missing.outputs, {});
    assert.deepEqual(calls, [
      ['code', 'icd10cm', 'R07'],
      ['code', 'icd10cm', 'R079']
    ]);
    await assert.rejects(
      () => run('find-code', { codeSet: 'cpt', code: '99213' }),
      /not a code set/
    );
  });

  it('finds the Medicare locality of a ZIP or ZIP+4, and not of a malformed one', async () => {
    const { calls, run } = setup();
    const found = await run('find-medicare-locality', { postalCode: '99501-1234' });
    assert.deepEqual(found.signature.execOut, ['found', 'notFound']);
    assert.deepEqual(found.outputs, {
      carrier: '02102',
      locality: '01',
      rurality: 'urban',
      plusFourNeeded: false
    });
    assert.deepEqual((await run('find-medicare-locality', { postalCode: '1234' })).outputs, {});
    assert.deepEqual(calls, [['locality', '995011234']]);
  });

  it('works out the Medicare allowed amount for the distinct codes on the lines', async () => {
    const { calls, run } = setup();
    const { outputs } = await run('medicare-allowed', {
      lines: [
        { code: 'A0427', units: 1, chargeCents: 80_000 },
        { code: 'A0888', units: 2, chargeCents: 3_000 },
        { code: 'A0888', units: 1 }
      ],
      serviceDate: '2026-11-02',
      carrier: '02102',
      locality: '01',
      rurality: 'superRural'
    });
    assert.deepEqual(outputs, {
      lines: [{ code: 'A0427', units: 1, allowedCents: 80_000 }],
      totalCents: 80_000,
      missing: ['A0888']
    });
    assert.deepEqual(calls, [['fees', 2026, '02102', '01', ['A0427', 'A0888']]]);
    await assert.rejects(
      () =>
        run('medicare-allowed', {
          lines: [{ code: 'A0427', units: 1 }],
          serviceDate: '2026-11-02',
          carrier: '02102',
          locality: '01',
          rurality: 'suburban'
        }),
      /not urban, rural or superRural/
    );
    await assert.rejects(
      () =>
        run('medicare-allowed', {
          lines: [{ code: 'A0427', units: 1 }],
          serviceDate: 'soon',
          carrier: '02102',
          locality: '01',
          rurality: 'urban'
        }),
      /not a date of service/
    );
  });

  it('finds the place of a ZIP by its first five digits', async () => {
    const { calls, run } = setup();
    assert.deepEqual((await run('find-zip-place', { postalCode: '36301-0001' })).outputs, {
      city: 'Dothan',
      state: 'AL',
      county: 'Houston',
      countyFips: '01069',
      latitude: 31.1429,
      longitude: -85.4022
    });
    assert.deepEqual((await run('find-zip-place', { postalCode: '00000' })).outputs, {});
    assert.deepEqual(calls, [
      ['place', '36301'],
      ['place', '00000']
    ]);
  });

  it('finds a hospital by name in a state, and nothing without a name or a US state', async () => {
    const { calls, run } = setup();
    assert.deepEqual(
      (
        await run('find-hospital', {
          name: 'Southeast Health',
          state: '01',
          postalCode: '363010000'
        })
      ).outputs,
      hospital
    );
    assert.deepEqual((await run('find-hospital', { name: 'Elsewhere', state: 'al' })).outputs, {});
    assert.deepEqual(calls, [
      ['hospital', 'Southeast Health', 'AL', '36301'],
      ['hospital', 'Elsewhere', 'AL', null]
    ]);
    assert.deepEqual(
      (await run('find-hospital', { name: 'Southeast Health', state: 'ZZ' })).outputs,
      {}
    );
    assert.deepEqual((await run('find-hospital', { state: 'AL' })).outputs, {});
    assert.equal(calls.length, 2);
  });
});
