import { isValidNpi } from '@ugula/billing';
import * as v from 'valibot';

const digits = (n: number, message: string) =>
  v.pipe(
    v.string(),
    v.transform((s) => s.replace(/\D/g, '')),
    v.regex(new RegExp(`^\\d{${n}}$`), message)
  );

const required = v.pipe(v.string(), v.trim(), v.nonEmpty());

const TIME_ZONES = new Set(Intl.supportedValuesOf('timeZone'));

const clearinghouseId = v.nullable(
  v.pipe(
    v.string(),
    v.trim(),
    v.regex(/^[A-Za-z0-9]{2,15}$/, 'Clearinghouse IDs are 2 to 15 letters or digits')
  )
);

export const billingProfileSchema = v.object({
  organizationName: v.pipe(required, v.maxLength(60)),
  npi: v.pipe(
    digits(10, 'An NPI has 10 digits'),
    v.check(isValidNpi, 'This NPI fails its check digit')
  ),
  taxId: digits(9, 'A tax ID (EIN) has 9 digits'),
  addressLine: v.pipe(required, v.maxLength(55)),
  city: v.pipe(required, v.maxLength(30)),
  state: v.pipe(
    v.string(),
    v.trim(),
    v.toUpperCase(),
    v.regex(/^[A-Z]{2}$/, 'Use a 2-letter state')
  ),
  postalCode: digits(9, 'Use the 9 digit ZIP+4 code'),
  phone: digits(10, 'A phone number has 10 digits'),
  timeZone: v.pipe(
    v.string(),
    v.trim(),
    v.check((tz) => TIME_ZONES.has(tz), 'Choose a time zone such as America/Chicago')
  ),
  submitterId: clearinghouseId,
  receiverId: clearinghouseId,
  receiverName: v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(60))),
  production: v.boolean()
});

export type BillingProfileInput = v.InferOutput<typeof billingProfileSchema>;
