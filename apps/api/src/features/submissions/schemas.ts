import * as v from 'valibot';
import { uuid } from '../../shared/http.ts';

export const batchSchema = v.object({ claimId: uuid });

export const pendingQuery = v.object({ claimId: uuid });

export const manualSubmissionSchema = v.object({
  claimId: uuid,
  note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500)), '')
});
