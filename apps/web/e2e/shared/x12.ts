import { build271, build277, build835, build999 } from '@ugula/billing/mock';

const at = { createdAt: new Date('2026-11-03T12:00:00Z') };

const PAYER_CLAIM_NUMBER = 'MCR-E2E-1';

export const eligibility271 = (trace: string, active: boolean) =>
  build271({ trace, active, ...(active ? {} : { message: 'Coverage terminated 2026-08-31' }) }, at);

export const batchAcknowledgment999 = (batchControl: number, accepted: boolean) =>
  build999(
    {
      groupControlNumber: String(batchControl),
      transactions: [
        {
          controlNumber: '0001',
          accepted,
          errors: accepted
            ? []
            : [
                {
                  segment: 'NM1',
                  position: 12,
                  loop: '2010',
                  code: '8',
                  element: { position: '9', code: '7' }
                }
              ]
        }
      ]
    },
    at
  );

export const claimAcknowledgment277 = (claimNumber: string, rejection: string | null) =>
  build277(
    {
      claims: [
        {
          claimNumber: String(claimNumber),
          rejection,
          payerClaimNumber: PAYER_CLAIM_NUMBER,
          patient: { lastName: 'KLINE', firstName: 'DOROTHY' }
        }
      ]
    },
    at
  );

export const remittance835 = (claimNumber: string, chargeCents: number, paidCents: number) =>
  build835(
    [
      {
        claims: [
          {
            claimNumber: String(claimNumber),
            chargeCents,
            paidCents,
            payerClaimNumber: PAYER_CLAIM_NUMBER
          }
        ]
      }
    ],
    at
  );
