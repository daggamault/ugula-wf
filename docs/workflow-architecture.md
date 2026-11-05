# Workflow Architecture Review

A critical review of today's billing workflows and override mechanism, what EMS billing needs for MVP, and a proposed structure where every billing decision is a small, named, overridable subworkflow.

---

## 1. Where We Are

### What already works

- Encounter to Claim is decomposed into ~40 subgraphs (Classify Trip, Level of Service, Loaded Miles, Map Charges, Map Claim, Map 837P are graphs, not code).
- Runs pin their dependency bundle at start; tenant overrides resolve by key; publish checks that the override keeps the base contract.
- CR1, CRC, prior authorization, frequency codes, COB loops (2320/2330) and PLB parsing exist in the X12 layer.

### Engine and override defects (fix before building on overrides)

| #   | Problem                                                                                                                        | Where                                                  | Consequence                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Child runs (`start-workflow`, `spawn-workflows`, recover-draft) resolve fresh instead of inheriting the parent's pinned bundle | `libs/data/db/src/runs.ts`, worker `queries.ts`        | A claim started before an override is published runs its cycle on the override; behaviour of one claim is split across versions |
| E2  | Tenant resolution returns the highest active tenant version for any requested `key@version`                                    | `libs/data/db/src/graph-versions.ts`                   | Version numbers mean nothing once overridden; a base v2 can never coexist with an override of v1                                |
| E3  | Overrides store no base version they were copied from                                                                          | `.migrations/graphs.ts`                                | No diff, no "base changed" warning, no merge                                                                                    |
| E4  | Seeding rewrites published system v1 in place (trigger disabled)                                                               | `.seeds/graphs.ts`                                     | Pinned runs silently change logic; breaks the immutability guarantee                                                            |
| E5  | Contract check runs once at publish, against the newest base only; ignores `optional`, ignores variables                       | `apps/api/src/features/graphs/service.ts:71`           | A base change can break a live override with no signal                                                                          |
| E6  | Manual payer-file upload calls `applyPayerFile` directly                                                                       | `apps/api/src/features/payer-files/service.ts`         | Overrides of Receive Payer File don't apply; no review tasks spawn                                                              |
| E7  | Child references hardcoded to `version: 1`                                                                                     | seed configs, worker/api constants                     | Base graphs can't be versioned                                                                                                  |
| E8  | Pins have no description; exec pins have no label; node config other than tables is raw JSON                                   | `libs/kernel/graph/src/types.ts`, `node-inspector.tsx` | Agencies cannot understand or safely edit a node                                                                                |

### Billing logic hidden in code (not overridable)

| Node                                                               | Hidden decisions                                                                                                                      | Now                                                                                                                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `billing.claim-step`                                               | Payer order, when review is required, follow-up timing, when to bill the patient, overpayment, collections threshold, step→status map | **Done:** Read Claim Ledger (action) → Next Claim Step (rule, Claim Policy and Claim Steps tables) → Record Claim Step; status lookup in the cycle      |
| `billing.validate-claim`                                           | Every blocking/warning rule, including payer-specific ones (Medicare PCS, filing limits, max miles)                                   | **Done:** Check Claim stage, 14 check rules, Check Severity table, Agency Checks slot; code only computes Check Facts                                   |
| `billing.apply-payer-file` (+ `libs/data/db/src/payer-files.ts`)   | 835 posting, CARC/group-code handling, what is a "problem" line, how an inactive 271 blocks billing                                   | **Done for 835:** Classify Adjustments, Route Remittance (Adjustment Classes, Remittance Routing tables); inactive 271 is the `coverage-inactive` check |
| `billing.prepare-837p`                                             | Frequency, prior-payer adjudication, pending issues                                                                                   | **Done:** Claim Frequency rule; prepare takes the payer the cycle decided; blocking issues come from Check Claim                                        |
| `billing.price-claim`                                              | Precedence (claim → payer → default)                                                                                                  | **Done:** Find Fees (action) → Price Precedence (rule) → Price Lines                                                                                    |
| `billing.read-signature`, `billing.patch-claim` (`changesCharges`) | Signature classification; which edits force a reprice                                                                                 | **Done:** Reprice Triggers rule and table; signature classification stays a fact read in code                                                           |

The posting decisions left `payer-files.ts`; it now only reads, matches and persists.

### Billing coverage gaps for MVP

Still missing: insurance discovery, MSP questionnaire, ABN with GA/GZ (GY exists), QL (dead before transport), GM (multiple patients), A0888 non-covered miles, rural/super-rural, deciding Part A/SNF responsibility at intake, and EFT reassociation. **Built since:** TA1, 276/277 claim status, real-time and batch 270/271, per-agency clearinghouse connections, denial routing by CARC (Work Denial), corrected claims vs. reopenings, appeals with deadlines and packets, records requests, refunds with approval and the Medicare 60-day deadline, closing approvals, daily deadline watching, state balance-billing protection on statements, and facility invoicing (see [Billing Workflows](billing-workflows.md)).

---

## 2. Design Principles

1. **One event, one workflow.** Every inbound file, timer and human decision starts or resumes a named workflow. No event is handled by code alone.
2. **Three layers of graph.** Agencies mostly touch the bottom layer.
   - **Workflow** (orchestration): reacts to an event, sequences stages, owns waits and tasks. Rarely overridden.
   - **Stage** (a cohesive step such as _Determine Payers_): calls rules and actions in order. Sometimes overridden.
   - **Rule** (pure): typed facts in, typed decision out, no side effects. The intended override point.
   - **Action** (capability node, code): I/O only — parse, store, send, match, render. Never contains a business decision that a rule could make.
3. **Decisions return reasons.** Every rule outputs its result plus `reasons` (text and source field), so a biller sees _why_ a claim got ALS2, a GY modifier or a block.
4. **Contracts are models, not pin lists.** A rule takes `Facts` and returns a model (`Charges`, `ClaimProperties`, `Coverages`). Adding an optional field to a model never breaks an override; adding a pin does.
5. **Extend before you replace.** Each stage exposes empty **Agency Rule** slots (pass-through by default). Most agency needs are "add one adjustment after the base logic", which needs no copy of the base and never drifts.
6. **Data before graphs.** Fee schedules, CARC routing, payer rules and modifier tables are versioned **tables** an agency overrides as forms. Most customizations should be a table row, not a node.
7. **Code is the floor, not the ceiling.** Capability nodes keep only what a graph cannot do (X12 serialization, matching, model calls, storage). Everything they decide today moves to rules.

---

## 3. The Facts Model

Every rule reads one normalized, typed snapshot instead of reaching into the NEMSIS tree. This keeps rules short and stops agency logic depending on NEMSIS versions.

`Encounter Facts` (built once by _Map Encounter Facts_, rebuilt on revision):

| Section         | Contents                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------- |
| Trip            | trip type, response mode (initial and final), service type, disposition, dates/times, unit, crew    |
| Locations       | pickup and drop-off address, ZIP, facility type, origin/destination modifier letters, rural class   |
| Patient         | demographics, weight, deceased timing (before/after loading), multiple-patient count                |
| Clinical        | impressions, symptoms, coded procedures and medications, vitals, narrative findings with quotes     |
| Documentation   | signature/exception, PCS (type, date, signer), ABN, prior authorization UTN, MSP answers, facesheet |
| Coverage claims | payers as reported on the PCR (raw), payment method                                                 |

Each later stage adds its own section to a **Claim Draft** (`Service`, `Diagnoses`, `Charges`, `Coverages`, `ClaimProperties`, `Issues`), so the 837P mapper reads one model.

---

## 4. Workflow Catalog

Each row is a top-level workflow (W) started by an event. Stages (S) are overridable subworkflows; rules (R) are the small override points. `+slot` marks an empty Agency Rule slot.

**Built:** §4.1 Map Encounter Facts (with Agency Facts), Classify Trip, Determine Service (Level of Service, Emergency Status, Loaded Miles), Assign Diagnoses (from coded impressions), Determine Payers (Coverages From PCR, Match Payer Directory, Coordination Order), Assign Charges (Base Rate Code, Mileage Lines, Price Precedence), Assign Claim Properties (Origin/Destination Modifiers, Transport Reason; Place of Service, Ambulance Conditions, Claim Frequency and Line Modifiers at 837P time), Check Claim (§4.6 base checks except ABN, prior authorization, weight, duplicate, member ID format and PO box) and Coding Review, each with its slot; §4.4 Read Claim Ledger, Next Claim Step and Claim Policy; §4.7 Classify Adjustments and Route Outcome (Remittance Routing) inside Receive Payer File, Work Denial (Denial Category), Correct Claim (Replacement or Reopening), Appeal Claim (Appeal Level and Deadline, Build Appeal Packet, Appeal Decision) and Respond to Records Request; §4.4 Bill Facility (the facility step and Invoice Facilities) and Bill Patient (Patient Responsibility with Balance-Billing Protection); §4.8 Refund Overpayment and collections and write-off approval (Approve Closing); §4.9 Watch Deadlines. The catalog with keys is in [Billing Workflows](billing-workflows.md). Narrative Note, Admission Date, Medicare Secondary Payer, Facility Responsibility, QL, GM and A0888 are not built yet.

### 4.1 Intake: PCR received → Ready for review

`W Encounter to Claim` (event: NEMSIS PCR received, new or revised)

| Stage                     | Rules and actions                                                                                                                                                        | MVP |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| S Import Report           | A Read NEMSIS Report · A Open Draft Claim · R Detect Revision                                                                                                            | yes |
| S Map Encounter Facts     | R Trip Facts · R Location Facts · R Clinical Facts · R Documentation Facts · `+slot` Agency Facts                                                                        | yes |
| S Read Documents          | A Store Attachments · A Embed Narrative · A Read Narrative (findings with quotes)                                                                                        | yes |
| S Classify Trip           | R Trip Type (table) · R Is Billable · `+slot`                                                                                                                            | yes |
| S Resolve Patient         | A Match Patient · task Confirm Patient · A Assign Patient                                                                                                                | yes |
| S Determine Service       | R Level of Service (table) · R Emergency Status · R Deceased Handling (QL) · R Multiple Patients (GM) · R Loaded Miles · R Non-covered Miles (A0888) · `+slot`           | yes |
| S Assign Diagnoses        | R Diagnoses From Coded Impressions · R Diagnoses From Narrative (model + vectors, with quotes) · R Order Diagnoses · `+slot`                                             | yes |
| S Determine Payers        | see 4.2                                                                                                                                                                  | yes |
| S Assign Charges          | R Base Rate Code · R Mileage Lines · R Modifiers (origin/destination, GA/GY/GZ, QL, GM) · R Supply/Add-on Lines · A Price Charges · R Price Precedence (table) · `+slot` | yes |
| S Assign Claim Properties | R Place of Service · R Transport Reason (CR104) · R Ambulance Conditions (CRC) · R Narrative Note (NTE) · R Admission Date · R Frequency · `+slot`                       | yes |
| S Check Claim             | runs every Check rule (4.6) and collects `Issues`                                                                                                                        | yes |
| S Coding Review           | task Review PCR (with every rule's reasons) · A Save Claim                                                                                                               | yes |
| —                         | A Start Claim Cycle                                                                                                                                                      | yes |

### 4.2 Payers

`S Determine Payers` (inside intake; reruns on eligibility, MSP or patient updates)

| Rule / action               | Purpose                                                                                                | MVP       |
| --------------------------- | ------------------------------------------------------------------------------------------------------ | --------- |
| R Coverages From PCR        | PCR insurances and payment method → coverage candidates                                                | yes       |
| A Match Payer Directory     | name/alias/embedding/model → payer; task Confirm Payer                                                 | yes       |
| R Medicare Secondary Payer  | MSP answers → Medicare primary or secondary                                                            | yes       |
| R Facility Responsibility   | interfacility during Part A or SNF stay, or contract facility → bill facility instead                  | yes       |
| R Liability Payers          | MVA/PIP, workers' comp → billed first                                                                  | flag only |
| R Coordination Order        | primary/secondary/tertiary, crossover expectations (COBA, Medigap)                                     | yes       |
| R Payer Rules               | merges the payer profile (rounding, A0998 accepted, frequency 7/8 support, timely filing, PA required) | yes       |
| `+slot` Agency Payer Rules  | e.g. "county contract pays all 911 transports from ZIP X"                                              | yes       |
| W Check Eligibility (child) | see 4.3                                                                                                | yes       |

### 4.3 Eligibility and discovery

| Workflow                     | Event                                                   | Stages                                                                                                                                                               | MVP      |
| ---------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| W Check Eligibility          | coverage added or changed, coding review opened, manual | R Needs Eligibility Check · A Send 270 (real-time if supported, else batch) · wait for 271                                                                           | yes      |
| W Apply Eligibility Response | 271 received                                            | A Read 271 · R Coverage Status · R Plan Switch (Medicare → Medicare Advantage plan) · R Coverage Dates vs Date of Service · R Inpatient/Hospice Flags · signal claim | yes      |
| W Discover Insurance         | no coverage, or all coverages inactive                  | A Send Discovery Request · R Candidate Coverages · task Confirm Coverage                                                                                             | post-MVP |

### 4.4 Claim cycle

`W Cycle Claim` stays the long-running owner of a claim, but `Claim Step` becomes a small action that only **reads the ledger**; deciding the next step becomes a rule.

| Stage                  | Rules and actions                                                                                           | MVP |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- | --- |
| A Read Claim Ledger    | balances per payer, last events, pending responses, deadlines                                               | yes |
| R Next Claim Step      | ledger → step (table-driven): review, submit, await, follow up, next payer, patient, collections, close     | yes |
| R Claim Policy (table) | waits, statement count and interval, collections threshold, auto-write-off limit, review required per payer | yes |
| S Submit to Payer      | see 4.5                                                                                                     | yes |
| S Follow Up Payer      | timer → W Check Claim Status (276) → task if still unknown                                                  | yes |
| S Bill Next Payer      | R Secondary Claim Data (COB loops from prior 835) · R Crossover Expected (skip and wait)                    | yes |
| S Bill Facility        | R Facility Invoice Lines · A Issue Facility Invoice                                                         | yes |
| S Bill Patient         | R Patient Responsibility · R Balance-billing Protection (state, plan type) · A Issue Statement              | yes |
| S Close Claim          | R Close Reason · A Close Claim                                                                              | yes |

### 4.5 Submission and acknowledgments

| Workflow / stage               | Event                            | Rules and actions                                                                                                                                                                                                 | MVP      |
| ------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| S Submit to Payer              | step = submit                    | R Ready to Submit (blocking issues, review approved) · S Map 837P (per payer: R Subscriber · R Payer · R Claim Header · R Ambulance Segments · R Service Lines · `+slot`) · A File 837P · A Send to Clearinghouse | yes      |
| W Receive Acknowledgment       | TA1 received                     | R Interchange Status · task Fix Envelope (agency setup, not claims)                                                                                                                                               | yes      |
| W Receive Acknowledgment       | 999 received                     | R Group/Transaction Status · per rejected claim: signal claim with reason                                                                                                                                         | yes      |
| W Receive Claim Acknowledgment | 277CA received                   | per claim: R Claim Status Category (A1/A2 accept, A3+ reject) · A Store Payer Claim Number · signal claim                                                                                                         | yes      |
| W Check Claim Status           | timer: no 277CA or 835 in N days | A Send 276 · wait 277 · R Status Meaning (pended, ADR, denied, paid)                                                                                                                                              | yes      |
| W Receive Clearinghouse Report | proprietary front-end rejection  | R Map Report to Claim Rejections                                                                                                                                                                                  | post-MVP |

### 4.6 Checks (the validator, split up)

`S Check Claim` runs a list of check rules. Each returns `Issues` (`code`, `severity`, `message`, `fix field`). Agencies override one check, change a severity in the **Check Severity** table, or add checks in a slot.

Base checks (MVP): Billing Signature or Exception · PCS Required (scheduled non-emergency Medicare, 60 days, 48h/21-day rules) · Prior Authorization UTN (repetitive scheduled) · Transport Reason Present · Origin/Destination Modifiers · Mileage Present and Rounded · Diagnosis Present · ABN for Expected Denial · Timely Filing · Times in Order · Patient Weight (bariatric) · Duplicate Claim · Member ID Format · Pickup Address Not PO Box.

### 4.7 Remittance, denials and appeals

| Workflow                     | Event                  | Stages                                                                                                                                                                                                                                                             | MVP                                                               |
| ---------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| W Receive Remittance         | 835 received           | A Read 835 · per claim: spawn W Post Payment · R Provider Adjustments (PLB) → task                                                                                                                                                                                 | yes                                                               |
| W Post Payment               | one CLP                | R Match Claim · R Classify Adjustments (CARC/RARC + group → contractual, patient responsibility, denial, other) · A Post Ledger · R Route Outcome (table: CARC → next payer, patient, fix and resubmit, appeal, write off, bill facility) · `+slot` · signal claim | yes                                                               |
| W Work Denial                | denial routed          | R Denial Category · task Denial Decision (correct, appeal, rebill other payer, patient, write off)                                                                                                                                                                 | yes                                                               |
| W Correct Claim              | biller chooses correct | R Replacement or Reopening (payer rule: frequency 7/8 vs Medicare reopening) · S Submit to Payer                                                                                                                                                                   | yes                                                               |
| W Appeal Claim               | biller chooses appeal  | R Appeal Level and Deadline · A Build Appeal Packet (PCR, PCS, signatures, facesheet) · task Send Appeal · wait decision                                                                                                                                           | redetermination and reconsideration                               |
| W Respond to Records Request | ADR received           | task Gather Records · deadline timer                                                                                                                                                                                                                               | task only (built: from the claim page; Watch Deadlines raises it) |
| W Reconcile Deposit          | EFT / lockbox file     | R Match Deposit to 835 (TRN)                                                                                                                                                                                                                                       | post-MVP                                                          |

### 4.8 Patient balance and money out

| Workflow               | Event                                                                                        | MVP       |
| ---------------------- | -------------------------------------------------------------------------------------------- | --------- |
| W Statement Cycle      | patient balance opened (statements, dunning, suppression rules)                              | yes       |
| W Post Patient Payment | payment entered                                                                              | yes       |
| W Refund Overpayment   | credit balance detected (R Refund Due · task Approve Refund · deadline for Medicare 60 days) | yes       |
| W Place in Collections | policy threshold reached (task approve)                                                      | task only |
| W Payment Plan         | plan created / installment missed                                                            | post-MVP  |

### 4.9 Documents and deadlines

| Workflow                    | Event                                                                                                                      | MVP           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------- |
| W Receive Document          | facesheet, PCS, signature, ABN, MSP form uploaded → R Classify Document · A Attach · rerun affected stage (facts → checks) | yes           |
| W Chase Document            | missing-document issue (task with deadline, repeats)                                                                       | yes           |
| W Track Prior Authorization | RSNAT request/decision (UTN, expiry)                                                                                       | tracking only |
| W Watch Deadlines           | daily timer: timely filing, PCS expiry, appeal due, ADR due                                                                | yes           |

---

## 5. Overrides

### Three ways to customize, from safest to most powerful

| Kind               | What the agency does                                          | Drift risk                 | Example                                                                    |
| ------------------ | ------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| **Table override** | Edits rows of a versioned table (form)                        | none                       | Add a CARC route; change a base rate code rule; relax a check to a warning |
| **Slot**           | Fills an empty Agency Rule slot that runs after the base rule | none (base keeps updating) | Add modifier `GM` for a county contract; add a supply line                 |
| **Graph override** | Copies one rule or stage and changes it                       | tracked (diff + merge)     | Replace Level of Service entirely                                          |

The editor offers them in that order: on any node, **Customize** opens a menu "Edit table / Add agency rule / Replace this rule".

### Engine changes required

1. **Base reference:** `graph_versions.base_version_id` on every override version (E3).
2. **Resolution by key and base version:** an override applies to the base versions it was built from or merged with, not to any version (E2). New base versions that keep the contract apply the override automatically; others flag it.
3. **Pin children to the parent bundle** (E1): child runs inherit the parent's resolved versions for keys already in the bundle; the cycle's bundle is pinned when the claim's cycle starts.
4. **Immutable seeds** (E4): seeding publishes a new version when the definition changes, never edits one in place; references use "latest compatible" instead of `version: 1` (E7).
5. **Contracts checked continuously** (E5): on every base publish, recheck every active override, including `optional`, defaults and model fields; incompatible overrides stay on the old base and raise a notification.
6. **Override tables independently:** tables become first-class keyed, versioned assets referenced by key from table nodes, so a table override needs no graph copy.
7. **Slots:** a `std.graph.slot` node (a subworkflow call to `<stage>.agency-<rule>` whose base version is a pass-through) so slots are ordinary overrides with nothing special at run time.
8. **Every event through a workflow** (E6): manual payer-file upload starts Receive Payer File like the poll does.

### Showing changes

Add one semantic token, `--color-custom` (a pink/fuchsia `light-dark()` oklch, distinct from `danger` and `primary`), and update the README colour rules to list it. It means "this agency changed this" everywhere:

- **Canvas:** nodes added or changed in an override get a `border-custom` outline and a small **Custom** chip; base nodes the override removed appear as dashed ghost nodes behind a "Show removed" toggle; wires that differ from the base use the custom colour.
- **Parent graphs:** a subworkflow node whose key the agency overrides (or whose slot is filled) gets the custom outline, so customizations are visible from the top workflow down.
- **Inspector:** each changed property shows a custom dot and "Base: _value_" with **Reset to Base**.
- **Customization map:** a page listing the call tree of each workflow with customized branches highlighted, so an agency (and our support) can see every change at once.
- **Base updated:** a warning banner on an override whose base has a newer version, with a three-pane diff (base before / base now / yours) and **Apply Base Changes** where they don't conflict (node ids are stable across copies, so diff is per node and per property).
- **Runs:** a run's page marks steps that executed agency logic.

### Node and property clarity

- `PinSpec` gets `description`; exec pins become `{ name, label, description }` (E8). A lint in the seed tests fails any published system graph with an undocumented pin, a non-Title-Case label, or an unlabelled exit.
- Every node's config gets a typed form (as tables already have); raw JSON is only an advanced view.
- Naming: rules are noun phrases of what they decide (`Transport Reason`, `Base Rate Code`), stages are verb phrases (`Assign Charges`), workflows name their event (`Receive Remittance`). Outputs name the decision, never `result`.
- Every rule exposes `reasons` and its inspector shows a **Test** panel: pick a recent claim, run the rule, see inputs, outputs and reasons, before publishing.

---

## 6. Clearinghouse Boundary

Batch SFTP covers 837P, 999, 277CA, 835 and batch 270/271/276/277. **Real-time** eligibility, claim status and insurance discovery at Waystar and others are HTTPS APIs (CAQH CORE), not SFTP, so "point the SFTP env vars at Waystar" is true only for batch traffic.

- Define a `Clearinghouse` port in `domain` with operations, not transports: `submitClaims`, `checkEligibility` (real-time or batch), `checkClaimStatus`, `discoverInsurance`, `pollResponses`.
- Adapters in `platform`: `sftp-batch` (today's code), `mock` (extend the mock to answer 270, 276 and discovery, real-time and batch), and later `waystar-api`.
- Store the connection **per agency** (settings, secrets encrypted), with env vars only as the default for dev. Agencies with their own Waystar accounts are common.
- Workflow nodes call the port (`Send 270`, `Send 276`), so the same graphs run against the mock and a real clearinghouse.

---

## 7. Suggested Order

1. Engine fixes E1–E8 (pinning, base reference, immutable seeds, pin descriptions, tables as assets, slots).
2. Diff and custom-accent UI, customization map, rule Test panel.
3. **Done:** Encounter Facts model; split `validate-claim` into check rules; move claim-step and posting decisions into rules and tables (see [Billing Workflows](billing-workflows.md)).
4. Missing MVP billing: MSP, facility responsibility at intake, ABN/GA/GZ, QL, GM, A0888. **Done:** TA1, 276/277, real-time and batch 270/271 through the port, CARC routing, denials, corrected claims, appeals, records requests, refunds, approvals, deadlines, balance-billing protection, facility invoicing.
5. Per-agency clearinghouse connections; post-MVP items (discovery, EFT reassociation, payment plans, esMD).

## 8. Open Questions

- Should agencies see and override **Stage** graphs, or only rules, tables and slots at first? (Recommendation: rules, tables and slots first; stages behind a role.)
- Do we bill hospital-based (837I) or air ambulance at all? (Recommendation: out of scope for MVP.)
- Expected-payment calculation from the Medicare fee schedule (RVUs, GPCI, rural add-ons) for underpayment detection — MVP or not?

## Sources

CMS Claims Processing Manual ch. 15 (ambulance); 42 CFR 410.40 (PCS), 424.36 (signatures), 424.44 (timely filing), 414.610 (fee schedule); CMS RSNAT prior authorization pages; CMS ambulance reason codes; MedPAC ambulance payment basics (2026); X12 element 1317 (CR104). Rules marked "verify" in the research (CR104 values Medicare accepts, CRC 06/07 meanings, CORE response time, overpayment timing, Medicare Part B frequency 7/8) need confirmation against the TR3 and the MAC's companion guide before implementation.
