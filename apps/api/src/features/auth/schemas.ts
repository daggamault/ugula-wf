import { emailString, nonEmpty } from '@ugula/config';
import * as v from 'valibot';

export const signInSchema = v.object({
  email: emailString,
  password: nonEmpty
});

export type SignInInput = v.InferOutput<typeof signInSchema>;
