import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { batchSchema, manualSubmissionSchema, pendingQuery } from './schemas.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

describe('submission schemas', () => {
  it('needs the one claim a pending check or 837P file is for', () => {
    assert.deepEqual(v.parse(pendingQuery, { claimId: ID }), { claimId: ID });
    assert.throws(() => v.parse(pendingQuery, {}));
    assert.throws(() => v.parse(batchSchema, { claimId: 'nope' }));
    assert.deepEqual(v.parse(batchSchema, { claimId: ID }), { claimId: ID });
  });

  it('trims manual submission notes and bounds their length', () => {
    assert.deepEqual(v.parse(manualSubmissionSchema, { claimId: ID }), { claimId: ID, note: '' });
    assert.deepEqual(v.parse(manualSubmissionSchema, { claimId: ID, note: '  faxed ' }), {
      claimId: ID,
      note: 'faxed'
    });
    assert.throws(() => v.parse(manualSubmissionSchema, { claimId: ID, note: 'x'.repeat(501) }));
  });
});
