import { MAX_BATCH_CLAIMS } from '@ugula/billing';
import * as v from 'valibot';
import { limitQuery, uuid } from '../../shared/http.ts';

export const batchSchema = v.object({
  claimIds: v.pipe(
    v.array(uuid),
    v.minLength(1, 'Select at least one claim'),
    v.maxLength(MAX_BATCH_CLAIMS, `A batch holds at most ${MAX_BATCH_CLAIMS} claims`)
  )
});

export const manualSubmissionSchema = v.object({
  claimId: uuid,
  note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500)), '')
});

export const listBatchesQuery = v.object({ limit: limitQuery });
