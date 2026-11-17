# Readable Workflows

Every billing decision should be readable on the canvas, built from small primitives the way Unreal Blueprints are. Code nodes do I/O and the few things a graph cannot do (X12, NEMSIS parsing, matching, the model, storage). Everything else, every comparison, default, choice, sum and date difference, is wired from primitives, so an agency can read a rule, override it and reuse its parts as subworkflows.

## Where we are (audit, November 2026)

- **Decisions are visible logic.** The billing seeds hold no formulas: `seed:check` and seeding fail on any Expression, list formula or expression binding in a billing graph. Every check, Next Claim Step, Route Remittance, Classification, Line Modifiers, Patient Responsibility, Deadline Action and every other decision is drawn as conditions that read as sentences, ordered first-that-applies choices, logic gates, rules run per item and combiners, and gives its reasons.
- **Tables hold reference data only.** The 38 shared billing tables are code sets, code labels, limits and settings, and pure code mappings (the CMS base rate code matrix, destination type → letter, appeal level days, refund and records days by payer kind); none decides a step, a route or a modifier (see [Overrides](overrides.md#shared-tables)).
- **Read nodes return stored facts.** Read Claim gives the Claim Record and the Claim Check Facts rule derives the check facts; Read Deadlines, Read Payer Response, Read Patient Balance and Read Credit Balance return what is stored, and Upcoming Deadlines, Payer Response Amounts, Patient Responsibility and Refund Due decide from it. Price Lines prices the units it is given; Billed Units rounds them.

## Principles

1. **Code nodes only touch the outside world.** A node whose name starts with Read returns stored facts as they are; anything derived from them is a rule. Matching (patients, payers) and X12, NEMSIS and the model stay in code.
2. **A rule is a graph of primitives.** Conditions read as sentences, choices are Choose Value or the first that applies, list work is a rule run per item. Expression is a last resort for arithmetic nobody needs to read, never for a decision.
3. **Decisions are drawn; tables hold reference data.** Code sets, code labels, limits, settings and pure code mappings are table rows an agency edits; any choice made on top of them is visible logic in a rule, not a table row.
4. **Small, named, reusable.** Logic used twice is a rule with a noun-phrase name (Person Name, Place Text, Check One Payer).

## Plan

### 1. Primitives (`libs/kernel/graph`)

- [x] **Rule per item:** Run Rule for Each, Keep Items Where and Find Item Where call a pure `node` graph once per item, keep types, and are pinned with the graph like any subworkflow.
- [x] Decision tables give the matched rule's label or the `otherwise` label as the reason.
- [x] Missing primitives the rewrites need: money text, start of period, drop empty fields, typed Make List and Join Lists, claim issue nodes; missing values pass through math, time and list nodes.
- [x] Comparison, logic, math, text, list and time primitives become `basic`.
- [x] Node titles follow Title Case with lowercase minor words (Greater or Equal, Wait for Signal, Sort by Field, Start of Period).
- [x] Conditions compare an input with another input, so a threshold wired from a table needs no subtract-then-test-against-0.
- [x] Text: Join's Last Separator ("a, b and c"), Count with Noun ("1 warning", "3 warnings"), Capitalize, and Fill Template, whose pattern arrives on a wire.
- [x] Where tests items as `listed` or `notListed` against a shared table, so a code set needs no one-item rule.
- [x] Round rounds up or down as well as to the nearest.

### 2. Rules as primitives (`.seeds/billing`)

- [x] Checks: each check is conditions building issues, per-payer checks run Check One Payer per payer.
- [x] Next Claim Step, Classify Adjustments, Line Modifiers, Coordination Order, Facility Responsibility, Deceased Handling, Patient Responsibility, Price Precedence, Determine Service, and every other formula in the billing seeds.
- [x] Display: Place Text, Blocking Summary, code-label lookups and templates with optional parts replace the formula builders; Can Rework Claim decides what Review Revision did in its display formula.
- [x] `seed:check` and seeding fail on any formula (Expression, list formula or expression binding) in a billing graph.
- [x] Second pass: one set of wiring helpers in `shared.ts` and one pin glossary; reusable rules (List Preview, Person Name, Report Subject, ZIP in Another State, Service Without Miles, Document Name, Time Left); task summaries and task details of the big stages pulled into their own rules; constants into tables (Check Limits, Medicare Claim Filings, Claim Policy review and claim status waits, Appeal Levels payer limit); table columns in Title Case and reasons as sentences.
- [x] Decision tables redrawn as visible logic: Claim Steps, Classification, Level of Service, Emergency Response, Non-Covered Miles, Pronounced Dead, MSP From the Report, Medicare Secondary Payer, Reprice Triggers, Mileage, Non-Covered Mileage, Facility Billed, Facility Responsibility, Document Kinds, Origin Modifier, Ambulance Conditions, Trip Modifiers, Coverage Modifier, Narrative Note, Claim Frequencies, Insurance Type Sent, Crossover Signals, Remittance Routing, Denial Categories, Correction Methods, Appeal Decisions, Balance-Billing Protection, Underpayment and Deadline Actions are rules; IV/IO Medication and ALS2 Procedure became the IV Solutions and ALS2 Procedures code sets.
- [x] Thresholds in tables: MSP Employer Sizes (20 and 100), Underpayment Limits, Deadline Limits, Unit Rounding; the approval limits in Claim Policy.

### 3. Decisions out of code (`libs/domain/billing`)

- [x] Claim Check Facts rule fed by a plain Read Claim; the API's claim page runs the same rule.
- [x] Signature classification as a rule: Billing Signature keeps the releases for billing, Release Signature classifies each with conditions and the Signature Exceptions tables, and the best kind wins.
- [x] Deadlines: Read Deadlines returns stored facts; Upcoming Deadlines and its small rules (Filing Limit, Filing Deadline, Certification Deadline, Task Deadline, Dated Deadline) decide due dates, days left, the window and whether a reminder was opened.
- [x] Payer response and patient balance: Read Payer Response and Read Patient Balance return stored facts; Payer Response Amounts decides the allowed amount and Patient Responsibility the cost share, dual eligibility and protection.
- [x] Mileage rounding as a rule: Billed Units and Billed Line round units before Price Lines prices them, and Map 837P rounds the loaded miles with Billed Units.
- [x] Payment Line and Post Claim Payment post what Route Remittance decided; Note PCR Revision only records.

Decided to stay in code:

- **The claim ledger projection** (Read Claim Ledger, Read Denial, Read Appeal Outcome, Read Credit Balance): the API and the database share it for claim status, so it stays one projection in code. Every decision on top of it (Next Claim Step, Denial Category, Correction Method, Appeal Decision, Refund Due) is a rule.
- **Match Patient's scoring** is matching (principle 1).
- **Close Claim's "paid once the balance is zero"** is a consistency guard inside the closing transaction, not a policy: the rule decides void, written off or collections, and the guard keeps a claim paid off meanwhile from closing as anything else.

### 4. Editor

- [x] Condition rules pick their input, test and value (or another input) in a form; Get Field picks its path from the record type.
- [x] Types adopted from the wire on connect (Get and Set Field, Make List, Join Lists, Choose Value, Reroute).
- [ ] Collapse selected nodes to a rule.
