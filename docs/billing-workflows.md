# Billing Workflows

All billing graphs are defined in code in `.seeds/billing/` (registry `billingGraphs` in `index.ts`, one file per area: `facts`, `service`, `charges`, `claim`, `checks`, `intake`, `cycle`, `payer-files`) and seeded as system graphs, in dependency order. Every billing decision is a small **rule** graph or a keyed **table**; **stages** sequence rules, actions and tasks; **workflows** react to an event. Code nodes only read and write (facts, storage, X12, the model) and never decide. Every pin and exit of every seeded graph has a Title Case label and a description: the seed runs `documentationIssues` next to `validateGraph` and fails on either. Pins the glossary (`.seeds/billing/glossary.ts`) knows are documented once there.

## Workflows and what starts them

| Workflow                         | Started by                                                                           | Does                                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `billing.ingest-nemsis`          | An upload or SFTP import                                                             | Splits a NEMSIS file and spawns one Encounter to Claim run per report                                                                                                                 |
| `billing.encounter-to-claim`     | Ingest; Rework Claim                                                                 | Opens a draft claim, maps the encounter facts, classifies the trip, resolves the patient and payers, reads the narrative, determines the service, has a biller review, builds, checks |
| `billing.cycle-claim`            | Start Cycle; a biller restarting the cycle                                           | Long-running loop: read the ledger, decide the Next Claim Step, check, review, submit 837P, wait, follow up, reconcile, bill the next payer, patient statements, close                |
| `billing.recover-draft`          | The worker, when an Encounter to Claim run ends and leaves a draft no run is working | Asks a biller what to do with the orphaned draft                                                                                                                                      |
| `billing.receive-payer-file`     | The clearinghouse poll; a payer file upload                                          | Reads the file, routes each 835 claim payment with Route Remittances, applies the file, asks to fix a rejected envelope (TA1) and spawns a review for each line that needs one        |
| `billing.check-eligibility`      | Build Claim saving the payers; Check Eligibility on a claim                          | Sends a 270 (real time when the connection supports it, else a batch .ELG), applies a real-time 271 at once and spawns a review for each line that needs one                          |
| `billing.review-payer-file-line` | Receive Payer File, Check Eligibility                                                | A task on the claim for one unclear payer file line                                                                                                                                   |

## Encounter Facts

`Map Encounter Facts` (stage) builds one typed **Encounter Facts** model (`billing.encounter-facts`) from the PCR, once per report, with Break and Make nodes like every model. Every later rule reads facts, never NEMSIS sections; task details (Review PCR, Review Updated PCR, Trip Summary) still show the report itself.

| Section       | Model                    | Rule                     | Holds                                                                                                                                             |
| ------------- | ------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| trip          | `billing.trip-facts`     | `billing.trip-facts`     | PCR number, date of service, call time, type of service, response mode, dispositions, level of care, CMS service level, ALS assessment, odometers |
| locations     | `billing.location-facts` | `billing.location-facts` | pickup and destination, incident location type, destination type, main reason for the destination                                                 |
| patient       | `billing.demographics`   | Demographics From PCR    | name, birth date, sex, address                                                                                                                    |
| clinical      | `billing.clinical-facts` | `billing.clinical-facts` | impressions, coded medications with routes, coded procedures, narrative                                                                           |
| documentation | `billing.documentation`  | Documentation Facts      | signature, certification, the transport reason as reported, conditions, prior authorization, weight, times                                        |
| coverages     | `billing.coverage` list  | Coverages From PCR       | insurances as reported, or the payer the payment method names (Payer by Payment Method table)                                                     |

The **Agency Facts** slot runs last.

## Intake: PCR received to Ready for review

```
read report → open draft claim
├ duplicate → Review Updated PCR (maps the facts, classifies) → Work the Claim Again | close
└ Work Draft Claim
   ├ Map Encounter Facts
   ├ Decide Whether to Claim: Classify Trip (Trip Type table → Agency Trip Type) → no-claim trips ask a biller
   ├ Read Narrative Findings (local model, with quotes)
   ├ Claim Patient (match, confirm, assign)
   ├ Determine Payers: Match Payer Directory → Coordination Order → Agency Payer Rules
   └ Bill the Claim
      ├ Determine Service: Emergency | Scheduled | Treat No Transport | Refusal → Agency Service
      │    each: Base Service = Level of Service + Emergency Status + Loaded Miles
      ├ Review PCR (coding review task, every reason shown)
      ├ Build Claim: Assign Charges → Assign Claim Properties → Agency Claim Rules → Save → Check Eligibility
      ├ Fix Claim: Check Claim → Fix Claim Data task → Patch → Reprice Triggers → Reprice Claim
      └ Start Payer Cycle
```

## Catalog

Roles set who may override a graph (see [Overrides](overrides.md)). Rules return their decision and `reasons`.

| Stage                   | Key                                                | Role  | Rules, actions and tasks                                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Map Encounter Facts     | `billing.map-encounter-facts`                      | stage | Trip Facts · Location Facts · Demographics From PCR · Clinical Facts · Documentation Facts · Coverages From PCR · `+slot` Agency Facts                                                                           |
| Classify Trip           | `billing.classify-trip`                            | rule  | Trip Type (`billing.trip-type` rule and table) · `+slot` Agency Trip Type                                                                                                                                        |
| Decide Whether to Claim | `billing.decide-claim`                             | stage | Classify Trip · task Confirm No Claim                                                                                                                                                                            |
| Resolve Patient         | `billing.resolve-patient`, `billing.claim-patient` | stage | A Match Patient · task Confirm Patient · A Assign Patient                                                                                                                                                        |
| Determine Payers        | `billing.determine-payers`                         | stage | Match Payer Directory (`billing.resolve-payers`, task Match Payer) · Coordination Order (Coverage Priority table) · `+slot` Agency Payer Rules                                                                   |
| Determine Service       | `billing.determine-service`                        | rule  | Emergency Trip · Scheduled Trip · Treat, No Transport · Refusal · Base Service · Level of Service (table) · Emergency Status (Emergency Response table) · Loaded Miles · `+slot` Agency Service                  |
| Assign Diagnoses        | `billing.assign-diagnoses`                         | rule  | Diagnoses From Coded Impressions · `+slot` Agency Diagnoses                                                                                                                                                      |
| Coding Review           | `billing.review-pcr`                               | stage | task Review PCR (with every rule's reasons) · task Held PCR                                                                                                                                                      |
| Assign Charges          | `billing.assign-charges`                           | stage | Map Charges (Base Rate Code, Mileage Lines) · `+slot` Agency Charges · Price Charges (A Find Fees · Price Precedence · A Price Lines · task Set Charge)                                                          |
| Assign Claim Properties | `billing.map-claim`                                | rule  | Assign Diagnoses · Origin/Destination Modifiers (Origin Modifier, Destination Modifier tables) · Transport Reason (Transport Reason by Destination Reason table); then `+slot` Agency Claim Rules in Build Claim |
| Check Claim             | `billing.check-claim`                              | stage | A Read Claim for Checks · Claim Checks · A Fix Claim Form                                                                                                                                                        |
| Fix Claim               | `billing.fix-claim`                                | stage | Check Claim · task Fix Claim Data · A Patch Claim · Reprice Triggers · Reprice Claim                                                                                                                             |
| Reprice Claim           | `billing.reprice-claim`                            | stage | Assign Charges · A Patch Claim                                                                                                                                                                                   |
| Map 837P Claim          | `billing.map-837p`                                 | rule  | Claim Frequency · Place of Service · Ambulance Conditions (table) · Line Modifiers (Coverage Modifier table) · `+slot` Agency 837P Rules                                                                         |

### Checks

`Claim Checks` (`billing.claim-checks`) runs every check rule on the **Check Facts** (`billing.check-facts`, read by `billing.read-claim-checks`, which also does the date math: days a certification was signed before the trip and days left to file). Each check returns issues `{ code, field, message, coverageId }`; the **Check Severity** lookup table (`billing.check-severity`) gives each code its severity (`blocking`, `warning` or `off`; a code not listed blocks), so an agency downgrades, upgrades or turns off a check with one row. The **Agency Checks** slot adds or drops issues before severities apply. The Fix Claim Data form asks the fields each issue's `field` names.

| Check rule                       | Codes                                                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `billing.check-last-submission`  | `submission-rejected`                                                                                                         |
| `billing.check-patient`          | `patient-missing`, `patient-address-missing`                                                                                  |
| `billing.check-report`           | `pcr-number-missing` (warning), `service-date-missing`                                                                        |
| `billing.check-service`          | `no-claim-trip`, `level-missing`, `emergency-missing`, `scheduled-emergency` (warning)                                        |
| `billing.check-charges`          | `lines-missing`, `lines-total`                                                                                                |
| `billing.check-diagnoses`        | `diagnosis-missing`                                                                                                           |
| `billing.check-locations`        | `pickup-address-missing`, `destination-address-missing`, `origin-destination-missing`                                         |
| `billing.check-transport-reason` | `transport-reason-missing`                                                                                                    |
| `billing.check-trip-times`       | `trip-times-missing`, `trip-times-order` (warnings)                                                                           |
| `billing.check-mileage`          | `loaded-miles-missing`, `loaded-miles-over-limit`, `loaded-miles-unlikely` and `miles-without-transport` (warnings)           |
| `billing.check-signature`        | `signature-exception` (warning), `signature-refused`, `signature-missing`                                                     |
| `billing.check-pcs`              | `pcs-missing-medicare`, `pcs-missing`, `pcs-undated`, `pcs-expired`, `pcs-late` (all but the first warnings)                  |
| `billing.check-payers`           | `payer-missing` (warning), `payers-over-limit`, `payer-unlinked`, `member-id-missing`, `insured-missing`, `coverage-inactive` |
| `billing.check-timely-filing`    | `filing-limit-passed`, `filing-limit-near` (warnings)                                                                         |

The claim page shows the same issues: the API runs the agency's effective `billing.claim-checks` and `billing.next-claim-step` rules (with its tables) for the claim it shows (`apps/api/src/shared/rules.ts`, `runRule`), so an agency's overrides apply there too.

## Claim cycle

`Cycle Claim` loops: **Read Claim Ledger** (action, `billing.read-claim-ledger`) states where the claim stands as a typed **Claim Ledger** (balance, the payer being billed and whether it has the claim or approved it, a response waiting to be reconciled, patient approval, statements and the time since each, why the last submission was rejected). **Next Claim Step** (rule) decides the step with the **Claim Policy** table (by the kind of payer billed, its claim filing indicator or `patient`: days to wait for a payer, statements to send and days between them, collections threshold, auto-write-off limit, review required) and the **Claim Steps** table (top to bottom: overpaid, closed, reconcile, review, submit, await, follow up, write off, review before the patient, confirm payers, wait between statements, statement, write off under the collections threshold, else collections). **Record Claim Step** stores the step's status (Status for the Step lookup) and continues through stale when the claim changed meanwhile. Steps the table marks `check` run Check Claim first (only patient issues before billing the patient, with the last rejection on review); a blocking issue sends the claim to Fix Claim.

| Step                  | Status                     | Subworkflow                                                                                                        |
| --------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| review, reviewPatient | needs_review               | Review Claim                                                                                                       |
| confirmPayers         | needs_review               | Confirm Payers                                                                                                     |
| submit                | ready                      | Prepare 837P → Map 837P → File 837P → Send 837P                                                                    |
| await, awaitPatient   | submitted, patient_balance | Wait For Signal (claim changes or the deadline)                                                                    |
| followUp              | follow_up                  | Follow Up Payer: 276 (real time, or batch and wait up to a day for the 277), then a task showing the latest status |
| reconcile, overpaid   | reconcile                  | Reconcile Payment, Refund Overpayment task                                                                         |
| statement             | patient_balance            | Send Statement                                                                                                     |
| collections           | balance_review             | Collections Review task                                                                                            |
| writeOff, closed      | —                          | Close Claim as written off or paid                                                                                 |

The base policy (30 days, 3 statements 30 days apart, no threshold, no auto-write-off, review required) keeps today's behavior; a new row for a payer kind changes it for those payers only.

## Payer files

`Receive Payer File` reads the file first (**Read Payer File**, no writes): its kind and, for an 835, each claim payment as a **Remittance Line** with the claim and payer it matched and the facts (denied, reversal, takeback, merged adjustments). **Route Remittances** runs **Route Remittance** per line: **Classify Adjustments** gives each adjustment a class by group code (**Adjustment Classes** table: CO and PI contractual, OA and CR other, PR patient responsibility; a denied claim lowers nothing) and adds up what lowers the balance; the **Remittance Routing** table (decision on the claim match, reversal, takeback, reason count, payer on the claim, denial, reason codes and classes) routes it: `reconcile` posts it and the cycle asks a biller to reconcile, `review` leaves it to a biller unposted, `unmatched` names no claim. **Apply Payer File** then applies the whole file once, posting each 835 line as routed; the data layer only persists. Later routes (next payer, patient, fix and resubmit, appeal, write off, bill facility) are new table rows and a branch in the graph.

## Target catalog

The [Workflow Architecture Review](workflow-architecture.md) sets out what is still to come: MSP, facility responsibility, ABN with GA/GZ, QL, GM, A0888, denial and appeal workflows, corrected claims, refunds, deadlines and balance-billing suppression, each as new rules, table rows or slots in this catalog.
