import { emailString, nonEmpty } from '@ugula/config';
import * as v from 'valibot';

export const signInSchema = v.object({
  email: emailString,
  password: v.pipe(nonEmpty, v.maxLength(1024))
});

export type SignInInput = v.InferOutput<typeof signInSchema>;
