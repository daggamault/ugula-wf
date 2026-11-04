import { emailString, nonEmpty } from '@ugula/config';
import * as v from 'valibot';

export const signInSchema = v.object({
  email: emailString,
  password: v.pipe(nonEmpty, v.maxLength(1024))
});

export type SignInInput = v.InferOutput<typeof signInSchema>;

export const newPassword = v.pipe(
  v.string(),
  v.minLength(12, 'Use at least 12 characters'),
  v.maxLength(1024)
);

const token = v.pipe(v.string(), v.nonEmpty(), v.maxLength(200));

export const setPasswordSchema = v.object({ token, password: newPassword });

export const tokenQuery = v.object({ token });

export const acceptInvitationSchema = v.object({
  token,
  password: v.pipe(nonEmpty, v.maxLength(1024))
});

export type AcceptInvitationInput = v.InferOutput<typeof acceptInvitationSchema>;
