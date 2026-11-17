import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '@ugula/graph/testing';
import { issueNodes } from './issues.ts';

const [issueWhen, issueForEach] = issueNodes(() => {
  throw new Error('no stores');
});

const pcs = { code: 'pcs-missing', field: 'pcs', message: 'The certification is missing' };

const when = async (inputs: Record<string, unknown>, config: Record<string, unknown> = pcs) => {
  if (!issueWhen) throw new Error('missing');
  return (await invokeNode(issueWhen, { inputs: inputs as never, config: config as never })).outputs
    .issue;
};

const forEach = async (inputs: Record<string, unknown>, config: Record<string, unknown>) => {
  if (!issueForEach) throw new Error('missing');
  return (await invokeNode(issueForEach, { inputs: inputs as never, config: config as never }))
    .outputs.issues;
};

describe('Issue When', () => {
  it('raises the configured issue when its condition holds', async () => {
    assert.deepEqual(await when({ when: true }), {
      code: 'pcs-missing',
      severity: null,
      field: 'pcs',
      message: 'The certification is missing',
      coverageId: null
    });
  });

  it('gives nothing when its condition does not hold', async () => {
    assert.equal(await when({ when: false, message: 'Signed 70 days ago' }), null);
  });

  it('takes the message and payer from the claim over the configured message', async () => {
    assert.deepEqual(await when({ when: true, message: 'Signed 70 days ago', coverageId: 'c1' }), {
      code: 'pcs-missing',
      severity: null,
      field: 'pcs',
      message: 'Signed 70 days ago',
      coverageId: 'c1'
    });
  });

  it('falls back to the configured message when the wired one is empty', async () => {
    assert.equal(
      ((await when({ when: true, message: '' })) as { message: string }).message,
      'The certification is missing'
    );
  });

  it('leaves the field and message empty when neither is configured', async () => {
    assert.deepEqual(await when({ when: true }, { code: 'x' }), {
      code: 'x',
      severity: null,
      field: null,
      message: null,
      coverageId: null
    });
  });

  it('needs an issue code', async () => {
    await assert.rejects(when({ when: true }, { code: '' }), /Name the issue code/);
  });

  it('summarizes as the code and message, or the code alone', () => {
    assert.equal(issueWhen?.summary?.(pcs as never), 'pcs-missing: The certification is missing');
    assert.equal(issueWhen?.summary?.({ code: 'x', field: '', message: '' } as never), 'x');
  });
});

describe('Issue for Each', () => {
  const pickup = {
    code: 'pickup-address-missing',
    field: 'pickup',
    message: 'The pickup {item} is missing'
  };

  it('raises one issue for each item, naming it in every {item}', async () => {
    assert.deepEqual(
      await forEach({ items: ['city', 'state'] }, { ...pickup, message: '{item}: the {item}' }),
      [
        {
          code: 'pickup-address-missing',
          severity: null,
          field: 'pickup',
          message: 'city: the city',
          coverageId: null
        },
        {
          code: 'pickup-address-missing',
          severity: null,
          field: 'pickup',
          message: 'state: the state',
          coverageId: null
        }
      ]
    );
  });

  it('names a missing item as blank', async () => {
    assert.deepEqual(
      ((await forEach({ items: [null] }, pickup)) as { message: string }[]).map((i) => i.message),
      ['The pickup  is missing']
    );
  });

  it('raises nothing without items or when its condition does not hold', async () => {
    assert.deepEqual(await forEach({}, { code: 'x' }), []);
    assert.deepEqual(await forEach({ when: false, items: ['city'] }, pickup), []);
  });
});
