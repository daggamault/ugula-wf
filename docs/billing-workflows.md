# Billing Workflows

All billing graphs are defined in code in `.seeds/billing-graphs.ts` (registry `billingGraphs`) and seeded as system graphs. Workflows run on their own; subworkflows (`kind: node`) are called by other graphs and are the override points.

## Workflows and what starts them

| Workflow                         | Started by                                                                           | Does                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `billing.ingest-nemsis`          | An upload or SFTP import                                                             | Splits a NEMSIS file and spawns one Encounter to Claim run per report                                                                                                                       |
| `billing.encounter-to-claim`     | Ingest; Rework Claim                                                                 | Opens a draft claim, classifies the trip, resolves the patient and payers, reads the narrative, suggests the service, has a biller review, builds and validates the claim, starts its cycle |
| `billing.cycle-claim`            | Start Cycle; a biller restarting the cycle                                           | Long-running loop: review, submit 837P, wait, follow up, reconcile payments, bill next payer, patient statements, close                                                                     |
| `billing.recover-draft`          | The worker, when an Encounter to Claim run ends and leaves a draft no run is working | Asks a biller what to do with the orphaned draft                                                                                                                                            |
| `billing.receive-payer-file`     | The clearinghouse poll; a payer file upload                                          | Applies an 835, TA1, 999, 277CA, 277 claim status or 271, opens a Fix clearinghouse setup task for a rejected envelope (TA1) and spawns a review for each line that needs one               |
| `billing.check-eligibility`      | Build Claim saving the payers; Check Eligibility on a claim                          | Sends a 270 (real time when the connection supports it, else a batch .ELG), applies a real-time 271 at once and spawns a review for each line that needs one                                |
| `billing.review-payer-file-line` | Receive Payer File                                                                   | A task on the claim for one unclear payer file line                                                                                                                                         |

## Encounter to Claim, step by step

```
read report → open draft claim
├ duplicate → Review Revision → Rework Claim | close
└ Work Draft Claim
   ├ Decide Claim: Classify Trip (decision table) → no-claim trips ask a biller
   ├ Read Findings (local model, with quotes)
   ├ Demographics From PCR → Claim Patient (match, confirm, assign)
   ├ Coverages From PCR → Resolve Payers (directory, embeddings, confirm)
   └ Bill Claim
      ├ Suggest Service → Emergency | Scheduled | Treat No Transport | Refusal
      │    each: Level of Service (decision tables) → Loaded Miles
      ├ Review PCR (task)
      ├ Build Claim: Map Charges → Price Charges → Map Claim (Trip Details, Documentation From PCR) → Save
      ├ Fix Claim (validate, task, patch, reprice)
      └ Start Cycle
```

## Claim cycle

`billing.claim-step` reads the claim's ledger and returns the next step; the cycle routes each step to a subworkflow:

| Step                  | Subworkflow                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| review, reviewPatient | Review Claim                                                                                                       |
| confirmPayers         | Confirm Payers                                                                                                     |
| submit                | Prepare 837P → Map 837P → File 837P → Send 837P                                                                    |
| await                 | Wait For Signal (claim changes or the deadline)                                                                    |
| followUp              | Follow Up Payer: 276 (real time, or batch and wait up to a day for the 277), then a task showing the latest status |
| reconcile             | Reconcile Payment                                                                                                  |
| statement             | Send Statement                                                                                                     |
| collections, overpaid | Tasks                                                                                                              |
| closed                | Close Claim                                                                                                        |

## Target catalog

The [Workflow Architecture Review](workflow-architecture.md) sets out the target: one workflow per event (PCR received, 271, 277CA, 999, TA1, 835, timers, documents, denials, appeals), each built from **stages** that call small **rules** with typed inputs and outputs, plus agency rule slots. It also lists the decisions that still live in code (`claim-step`, `validate-claim`, payer file posting, pricing order) and need to move into rules and tables.
