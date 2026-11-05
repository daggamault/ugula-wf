# EMS Billing Primer

A working summary of US ground ambulance billing for people building Ugula. Rules marked _verify_ need checking against the X12 TR3, CMS manuals and each payer's companion guide before they are relied on.

## The lifecycle

1. **Trip documented**: the crew completes an ePCR; the agency exports NEMSIS 3.4/3.5 XML.
2. **Coding and QA**: level of service (BLS, ALS1, ALS2, SCT, PI), emergency or not, loaded miles, origin and destination, medical necessity, documentation completeness.
3. **Payer determination**: coverages from the PCR, facesheets and eligibility checks (270/271); Medicare Secondary Payer questions; Part A or SNF stays billed to the facility; coordination of benefits order.
4. **Claim build**: 837P with ambulance segments, scrubbed against payer rules.
5. **Submission**: through a clearinghouse; TA1, 999, clearinghouse edits and 277CA acknowledgments.
6. **Follow-up**: 276/277 claim status when no answer arrives.
7. **Remittance**: 835 posting (CARC/RARC, group codes CO, PR, OA, PI, PLB), secondary claims, crossovers.
8. **Denials and appeals**: corrections (frequency 7/8 or Medicare reopenings), redetermination, reconsideration.
9. **Patient balance**: statements, payment plans, collections, refunds; state balance-billing laws.
10. **Reporting**: A/R aging, net collection rate, denial rates, payer mix.

## Transactions

| Transaction | Direction | Use                                                                           |
| ----------- | --------- | ----------------------------------------------------------------------------- |
| 837P        | out       | The professional claim                                                        |
| TA1         | in        | Envelope (ISA/IEA) accepted or rejected                                       |
| 999         | in        | Syntax accepted or rejected per group/transaction                             |
| 277CA       | in        | Payer accepted or rejected each claim (STC A1/A2 vs A3+) and its claim number |
| 270 / 271   | out / in  | Eligibility and coverage details; batch or real-time (CAQH CORE)              |
| 276 / 277   | out / in  | Claim status inquiry and response                                             |
| 835         | in        | Payment, adjustments and reasons                                              |
| 275         | out       | Attachments (PCS, PCR, signatures); Medicare uses esMD instead                |
| 824         | in        | Application advice used by some Medicaid programs                             |

## Ambulance claim specifics

- **HCPCS**: A0426 ALS1, A0427 ALS1 emergency, A0428 BLS, A0429 BLS emergency, A0433 ALS2, A0434 SCT, A0432 paramedic intercept, A0425 ground miles, A0888 non-covered miles, A0998 response without transport (not Medicare), A0999 unlisted. Place of service 41 (ground).
- **Mileage**: loaded miles only; under 100 rounded up to a tenth, 100 or more to the whole mile; never blank.
- **Modifiers**: an origin and destination letter pair on every line (D, E, G, H, I, J, N, P, R, S, X destination only); QL when pronounced dead before loading (bill BLS, no mileage); GM for multiple patients; GA/GZ/GY for liability (ABN on file, expected denial, statutorily excluded).
- **CR1**: weight, transport reason (A nearest facility, B preferred physician, C near family, D specialist, E rehab, F residential, G not transported; Medicare may accept only A–E, _verify_), loaded miles, round-trip and stretcher descriptions.
- **CRC ambulance certification**: up to five condition codes such as 01 admitted, 04 moved by stretcher, 05 unconscious or shock, 06 emergency, 07 restrained, 08 hemorrhage, 09 medically necessary, 12 confined to bed or chair (_verify_ 06/07).
- **Locations**: pickup in 2310E and drop-off in 2310F with street addresses; the pickup ZIP prices the claim (urban, rural, super-rural).
- **NTE** narrative (80 characters) and at least one ICD-10 diagnosis.

## Medicare rules

- **Physician certification (PCS)**: required for repetitive scheduled non-emergency transports (dated within 60 days before) and for most non-emergency facility patients (within 48 hours after; bill after 21 days of documented attempts). Not needed for emergencies.
- **Prior authorization for repetitive scheduled non-emergency transports** has been nationwide since 2022; the unique tracking number goes on the claim.
- **Signatures** (42 CFR 424.36): the beneficiary or representative signs, or a documented exception (crew statement plus facility record).
- **ABN** (CMS-R-131): non-emergency only; drives GA/GZ.
- **Timely filing**: 12 months from the date of service.
- **Fee schedule**: base rate = conversion factor × RVU × (0.3 + 0.7 × GPCI); rural mileage bonus; add-ons extended through 2027.
- **ET3** ended in 2023. **GADCS** data collection affects selected suppliers. The **No Surprises Act** still excludes ground ambulance; about 20 states protect patients on fully insured plans.

## Events that each get a workflow

**Files in**: NEMSIS PCR (new or revised), TA1, 999, clearinghouse rejection report, 277CA, 824, 271, discovery result, 277, 835, EFT/lockbox, documents (facesheet, PCS, signature, ABN, MSP), patient payments.

**Timers**: PCS expiry and chase, timely filing, no 277CA, no 835 (send 276), appeal deadlines, records requests, secondary filing windows, statement cycle, collections threshold, overpayment return deadline, annual fee schedule load.

**Decisions**: coding approval, payer order, discovery match, bill facility or payer, rejection fix, denial disposition, appeal approval, write-off, refund, hardship or payment plan, collections placement, correction vs reopening, balance-billing exceptions.

## MVP checklist

The full tagged checklist (MVP vs later) with sources is in the [Workflow Architecture Review](workflow-architecture.md#billing-coverage-gaps-for-mvp) and its sources section. Post-payment status:

| Item                                                                | Status                                                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Denial routing by CARC and a denial decision                        | Built: Remittance Routing, Work Denial, Denial Categories                                              |
| Corrected claims (frequency 7/8 with REF F8) vs Medicare reopenings | Built: Correct Claim, Correction Methods, payer Corrections setting (_verify_ Medicare Part B 7/8)     |
| Redetermination (120 days) and reconsideration (180 days)           | Built: Appeal Claim, Appeal Levels, appeal packet PDF; ALJ and Medicaid limits _verify_                |
| Records requests (ADR)                                              | Built as a task with a due date (Medicare 45 days _verify_)                                            |
| Refunds and the Medicare 60-day overpayment deadline                | Built: Refund Overpayment, Approve Refund (`claims:approve`), Refund Deadlines                         |
| Collections placement and large write-offs                          | Built: Approve Closing under the Claim Policy thresholds                                               |
| Deadlines (timely filing, appeals, records, refunds, PCS expiry)    | Built: Watch Deadlines every morning                                                                   |
| State balance-billing laws                                          | Built: Balance-Billing Protection with example rows NH, OR (2026-01-01), AL (2026-10-01), all _verify_ |
| Facility invoicing (Part A/SNF, contract facilities)                | Built: monthly invoice per facility; deciding responsibility at intake is not built here               |
| EFT reassociation, payment plans                                    | Not built                                                                                              |
