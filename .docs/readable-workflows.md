# Readable Workflows

Every billing decision should be readable on the canvas, built from small primitives the way Unreal Blueprints are. Code nodes do I/O and the few things a graph cannot do (X12, NEMSIS parsing, matching, the model, storage). Everything else, every comparison, default, mapping, sum and date difference, is wired from primitives, so an agency can read a rule, override it and reuse its parts as subworkflows.

## Where we are (audit, November 2026)

- **Rules are formulas.** The seeds hold 232 Expression nodes. All 18 check rules are each one formula of 183–1,325 characters. Next Claim Step, Classify Adjustments, Line Modifiers, Coordination Order, Facility Responsibility, Deceased Handling and Patient Responsibility hide their decision in a formula. Review Revision computes `canApply` inside a 3,200-character display formula and branches on it.
- **Read nodes decide.** `read-claim-checks` derives about 25 check facts in code (filing days left, transports, PCS days, Medicare). `read-claim-ledger` decides the current payer, whether an approval still counts and the active denial. `read-payer-response`, `read-patient-balance` and `read-refund` compute the allowed amount, cost share, dual eligibility and refund payer. `price-lines` rounds units. `find-deadlines` applies the 365-day federal limit and the 60-day PCS rule in SQL. `read-signature` is a NEMSIS code table in code. `close-claim` turns any status into paid at a zero balance.
- **Primitives are missing or hidden.** No way to run a rule per list item (only formula lambdas or durable child runs), so lists lose their types and per-item logic becomes a formula. No money formatting, start of month, rounding to a step, or labelled "otherwise" on decision tables. Nearly every math, logic, text and list node is `advanced`, so the palette hides them by default.

## Principles

1. **Code nodes only touch the outside world.** A node whose name starts with Read returns stored facts as they are; anything derived from them is a rule.
2. **A rule is a graph of primitives.** Conditions read as sentences, choices are Choose Value, mappings are tables, list work is a rule run per item. Expression is a last resort for arithmetic nobody needs to read, never for a decision.
3. **Constants live in tables.** Day limits, thresholds and code sets are table rows an agency edits, not literals.
4. **Small, named, reusable.** Logic used twice is a rule with a noun-phrase name (Person Name, Place Text, Check One Payer).

## Plan

### 1. Primitives (`libs/kernel/graph`)

- [x] **Rule per item:** Run Rule for Each, Keep Items Where and Find Item Where call a pure `node` graph once per item, keep types, and are pinned with the graph like any subworkflow.
- [x] Decision tables give the matched rule's label or the `otherwise` label as the reason, so rules stop rebuilding reasons.
- [ ] Missing primitives the rewrites need: money text, start of period, round to a step and direction, drop empty fields, sum and count by field.
- [ ] Comparison, logic, math, text, list and time primitives become `basic`.

### 2. Rules as primitives (`.seeds/billing`)

- [ ] Checks: each check is conditions building issues, per-payer checks run Check One Payer per payer.
- [ ] Next Claim Step, Classify Adjustments, Line Modifiers, Coordination Order, Facility Responsibility, Deceased Handling, Patient Responsibility, Price Precedence, Determine Service.
- [ ] Display: Person Name, Place Text and code-label lookups replace the formula builders; Review Revision's `canApply` becomes its own rule.
- [ ] A seed gate fails any rule graph that decides with Expression.

### 3. Decisions out of code (`libs/domain/billing`)

- [ ] Claim Check Facts rule fed by a plain Read Claim.
- [ ] Claim Progress rule fed by the claim's events (current payer, approval, denial).
- [ ] Payer response, patient balance and refund amounts as rules; filing limits, PCS days and thresholds as tables.
- [ ] Signature classification as a table; Close Claim takes the status a rule decided.

### 4. Editor

- [ ] Condition rules pick inputs and fields from the wired types; Get Field picks its path from the record type.
- [ ] Types adopted from the wire on connect.
- [ ] Collapse selected nodes to a rule.
