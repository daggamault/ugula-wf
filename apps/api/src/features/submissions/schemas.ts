import * as v from 'valibot';
import { uuid } from '../../shared/http.ts';

export const claimSchema = v.object({ claimId: uuid });
