export const PAYMENT_METHODS = {
  ACH: 'Automated Clearing House (ACH)',
  BOP: 'Financial Institution Option',
  CHK: 'Check',
  FWT: 'Federal Reserve Wire Transfer',
  NON: 'No Payment'
} as const;

export type PaymentMethod = keyof typeof PAYMENT_METHODS;

export const isPaymentMethod = (x: unknown): x is PaymentMethod =>
  typeof x === 'string' && Object.hasOwn(PAYMENT_METHODS, x);
