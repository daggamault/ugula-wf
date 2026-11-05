import { MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT } from '@ugula/access';
import { emailString, nonEmpty } from '@ugula/config';
import * as v from 'valibot';

export const signInSchema = v.object({
  email: emailString,
  password: v.pipe(nonEmpty, v.maxLength(1024))
});

export type SignInInput = v.InferOutput<typeof signInSchema>;

const newPassword = v.pipe(
  v.string(),
  v.minLength(MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT),
  v.maxLength(1024)
);

const token = v.pipe(v.string(), v.nonEmpty(), v.maxLength(200));

export const setPasswordSchema = v.object({ token, password: newPassword });

export const tokenSchema = v.object({ token });

export const acceptInvitationSchema = v.object({
  token,
  password: v.pipe(nonEmpty, v.maxLength(1024))
});

export type AcceptInvitationInput = v.InferOutput<typeof acceptInvitationSchema>;
