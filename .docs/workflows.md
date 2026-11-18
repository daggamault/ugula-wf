# Workflows

How billing is built on the engine: a few events start workflows, workflows are stages, stages are rules, and rules are primitives wired on the canvas. Only a handful of service nodes touch the outside world, and they all speak in typed records. Scope today is one path, from a NEMSIS XML file to a claim that needs review; everything later in the claim's life (submission, remittance, denials, patient balances) is rebuilt on the same model afterwards.

## Principles

1. **Records, not facts nodes.** Data moves as a few typed records (Encounter, Person, Scene, Destination, Insurance, Claim, Charge Line). Each has one Break and one Make node with every field; a field that holds another record is a typed pin you Break again. Every field may be empty: the XML requires little, so rules never assume a field is there. A not value (NV, as an attribute or as text) and a pertinent negative (PN) read as empty, except an Approximate value, which is kept.
2. **Primitives decide.** Every choice (is it billable, what level, which payer first, which modifier) is drawn from code lists, Contains and Equal, comparisons, And, Or and Not, Select and Choose Value, math, lists and lookups, so a biller can read it and an agency can override it. Small criteria rules (each giving Holds and Reasons) compose into the decisions, and per-item rules run under Keep Items Where.
3. **Services only touch the world.** A service reads or writes a record, matches, parses or prices, and never decides anything a rule could. There are few, and each is named for what it does to which record (Read PCR File, Save Encounter, Find Patient, Save Claim).
4. **Small graphs, named by what they give.** A rule is a pure graph named for the decision it returns (Trip Classification, Level of Service), and returns its reasons. A stage is a graph with a way in, named by its verb (Resolve Patient, Assign Charges). A workflow is named by its job and starts from one event.
5. **Events join workflows.** A workflow ends by saving a record, and the database emits the event for the change in the same transaction, so the next workflow starts from it. No workflow calls a later one by name.
6. **Reference data in tables.** Code mappings are tables an agency edits as forms, and prices are its fee schedules; a code list is a Constant inside the rule that tests it, changed by overriding that rule; decisions on top of them are drawn.
7. **Typed all the way.** NEMSIS coded fields and billing values (classification, level of service, origin and destination letters, X12 relationship) are code kinds, and generic primitives take the type of their first wire, so the editor refuses a wire between different code sets.

## Palette

| Group      | Nodes                                                                                                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Events     | The workflow's start, shown as the event it waits for (On PCR File Received, On Encounter Created) with the event's fields as pins, or On Schedule                                                              |
| Records    | Break and Make for Encounter, Times, Odometer, Person, Address, Scene, Destination, Payment, Insurance, Medication, Procedure, Vital Signs, Signature, Crew Member, Attachment, Claim, Coverage, Charge Line    |
| Primitives | Constant, Contains, Equal, compare, Is Null, And/Or/Not, Select, Choose Value, math, text, time, lists (Keep Items Where, Run Rule for Each, Find Item Where), Lookup Table, Branch, Switch, For Each, Sequence |
| Services   | Read PCR File, Read PCR, Save Encounter, Read Encounter, Find Patient, Save Patient, Find Payer, Find Fee, Save Claim                                                                                           |
| Endings    | Return, Fail                                                                                                                                                                                                    |
| Graphs     | Every rule, stage and workflow, called like a node                                                                                                                                                              |

## Records

**Encounter** is one patient care report, typed and named in billing terms instead of NEMSIS elements, with place codes turned into names. It is built in code from the report, because mapping hundreds of elements is parsing, not policy. Each field has a Title Case label and a description naming its element (`NEMSIS eDisposition.12, as the report gives it.`); coded fields are code kinds declared in `libs/domain/nemsis/src/kinds.ts`.

| Field                                                                                                                                    | Type                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `pcrNumber`, `revision`, `reportId`                                                                                                | `id<encounter>`, text, integer, `id<report>` (the stored PCR this copy was read from)                                                                                                                       |
| `incidentNumber`, `serviceType`, `unitNumber`, `callSign`, `responseMode`, `responseModifiers`                                           | text, `code<serviceType>`, text, text, `code<responseMode>`, `list<code<responseModifier>>`                                                                                                                 |
| `incidentDisposition`, `unitDisposition`, `patientEvaluation`, `crewDisposition`, `transportDisposition`, `levelOfCare`, `transportMode` | each a code of its own kind (`code<incidentDisposition>` and so on)                                                                                                                                         |
| `destinationReasons`, `patientsAtScene`, `patientsTransported`                                                                           | codes, a code, an integer                                                                                                                                                                                   |
| `times`                                                                                                                                  | Times: call, notified, en route, at scene, at patient, left scene, at destination, transfer of care, back in service                                                                                        |
| `odometer`                                                                                                                               | Odometer: begin, scene, destination, end                                                                                                                                                                    |
| `patient`                                                                                                                                | Person                                                                                                                                                                                                      |
| `pickup`, `destination`                                                                                                                  | Scene (name, `code<locationType>`, Address) and Destination (name, `code<destinationType>`, Address)                                                                                                        |
| `complaint`, `primarySymptom`, `otherSymptoms`, `primaryImpression`, `secondaryImpressions`, `workRelated`, `injuryCauses`               | text and codes; the impressions are `code<icd10>`                                                                                                                                                           |
| `cardiacArrest`, `arrestOutcome`                                                                                                         | `code<cardiacArrest>`, `code<arrestOutcome>`                                                                                                                                                                |
| `medications`, `procedures`, `vitals`                                                                                                    | lists of Medication, Procedure and Vital Signs                                                                                                                                                              |
| `payment`                                                                                                                                | Payment: method, certification (statement, date, reason), transport reason, ambulance conditions, closest facility miles, ALS assessment, crew-reported service level, condition codes, prior authorization |
| `insurances`, `signatures`, `crew`                                                                                                       | lists of Insurance (as reported), Signature and Crew Member                                                                                                                                                 |
| `narrative`                                                                                                                              | text                                                                                                                                                                                                        |
| `attachments`                                                                                                                            | list of Attachment (document type, file type, name, stored file)                                                                                                                                            |

**Person** (name parts, birth date, age, sex and gender, phone, weight and an Address), **Address** (street, city named from its place code, county, state, ZIP), **Insurance** (company ID and name, `code<billingPriority>`, group, member ID, insured name and `code<relationship>`), **Medication** (`code<rxnorm>`, `code<medicationRoute>`, dosage), **Procedure** (`code<snomed>`), **Claim** (encounter, patient, `code<tripClassification>`, service date, `code<levelOfService>`, emergency, loaded miles, origin and destination letters as `code<placeCode>`, diagnoses, `code<transportReason>`, `code<ambulanceCondition>` condition codes, weight in pounds, coverages, lines, total, reasons), **Coverage** (directory payer or reported name, member and group ID, `code<x12Relationship>`, insured name) and **Charge Line** (HCPCS code, modifiers, units, unit and total price in cents) are the rest.

## Events

| Event               | Payload                         | Emitted when                                          |
| ------------------- | ------------------------------- | ----------------------------------------------------- |
| `pcr_file.received` | import, file, file name         | A NEMSIS file is uploaded or arrives over SFTP        |
| `encounter.created` | encounter, PCR number           | Save Encounter stores a PCR number for the first time |
| `encounter.revised` | encounter, PCR number, revision | Save Encounter stores a changed copy of a PCR         |
| `claim.created`     | claim, encounter                | Save Claim stores a new claim                         |
| `task.completed`    | task, queue, outcome            | A biller completes a task                             |

## Workflows

Seeded in `.seeds/billing`; every graph key starts with `billing.`.

### Import PCR File (on `pcr_file.received`)

Read PCR File → For Each PCR → Try **Save PCR** (Read PCR → Save Encounter: Created, Revised or Unchanged) → count each outcome, and count a report that fails as Failed so the rest go on → Return the counts.

The API records the import and emits the event in one transaction; an upload is refused when no published workflow starts on it, so an agency can add its own workflow next to this one.

### Encounter to Claim (on `encounter.created`) and Revised Encounter to Claim (on `encounter.revised`)

Read Encounter → **Build Claim**: Trip Classification → Is Billable

- No → Not Billable, with the classification and its reasons.
- Yes → Resolve Patient → Determine Payers → Assign Charges → Make Claim (with Service Details, Diagnoses, Ambulance Details and the reasons of Payer Checks and Claim Checks) → Save Claim (Needs Review; a revised encounter replaces its claim as a new revision, back to Needs Review even when approved) → **Review Claim**: every claim ends on a Review the Claim task, as the law requires before a claim goes to the clearinghouse. Only a user with `claims:approve` can complete it: Approve makes the claim Approved, ready for the clearinghouse; Hold makes it On Hold with a note. The decision is recorded only for the revision the biller saw. When a revised encounter replaces a claim, the worker cancels the run still waiting on the earlier review, closing its task, so only the review of the current revision stays in the queue.

| Graph                    | Kind  | Built from                                                                                                                                                                                       |
| ------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trip Classification      | rule  | Not Billable, Refusal, Pronounced Dead, No Transport, Transport and Scheduled Criteria; the first kind of trip that holds (Choose Value over Selects), billable when it is in the billable kinds |
| Not Billable Criteria    | rule  | Incident, unit and transport dispositions and service type, each tested against a code list (Contains, Equal, Not, And)                                                                          |
| Refusal Criteria         | rule  | Refused care, or a refused evaluation and transport                                                                                                                                              |
| Pronounced Dead Criteria | rule  | Dead at the scene without transport, or expired in the field and not transported                                                                                                                 |
| No Transport Criteria    | rule  | Treated and not transported, or not transported by this unit                                                                                                                                     |
| Transport Criteria       | rule  | Transported by this unit, by incident or transport disposition                                                                                                                                   |
| Scheduled Criteria       | rule  | Scheduled or interfacility service type                                                                                                                                                          |
| Service Details          | rule  | Service Date, Level of Service, Emergency Status, Loaded Miles                                                                                                                                   |
| Level of Service         | rule  | IV Medication and ALS2 Procedure under Keep Items Where, counted; the highest of SCT, ALS2 and ALS1 Criteria that holds, else BLS                                                                |
| By This Unit             | rule  | Not before this unit arrived and not by another unit (Equal, Or, Not), so only this unit's care counts                                                                                           |
| IV Medication            | rule  | Given by this unit, IV or IO, and not an IV solution (two code lists), per medication                                                                                                            |
| ALS2 Procedure           | rule  | Performed by this unit and in the ALS2 code list, per procedure                                                                                                                                  |
| SCT Criteria             | rule  | Critical care, or crew-reported SCT, on an interfacility transport                                                                                                                               |
| ALS2 Criteria            | rule  | An ALS2 procedure, three or more IV/IO medications, or crew-reported ALS2                                                                                                                        |
| ALS1 Criteria            | rule  | ALS assessment, crew-reported ALS1, or an IV/IO medication                                                                                                                                       |
| Emergency Status         | rule  | The response urgency; without it the response mode; without either the call type or crew level                                                                                                   |
| Loaded Miles             | rule  | Destination less scene odometer, never below zero, rounded up to the tenth under 100 miles and to the whole mile from 100                                                                        |
| Service Date             | rule  | The first time recorded: at patient, at scene, notified, call                                                                                                                                    |
| Diagnoses                | rule  | Primary and secondary impressions, then primary and other symptoms, each once, at most twelve                                                                                                    |
| Ambulance Details        | rule  | The transport reason, condition codes each once and at most five, and the weight in whole pounds rounded up                                                                                      |
| Origin Letter            | rule  | The first that holds of the pickup location type (Starts With) and the service type (Contains)                                                                                                   |
| Origin and Destination   | rule  | Origin Letter; destination from the Destination Letters table; neither unless both                                                                                                               |
| Resolve Patient          | stage | Match Patient; Incomplete → task Complete the Patient, then Match Patient again                                                                                                                  |
| Match Patient            | stage | Find Patient → Matched; Not Found → Save Patient; Similar → task Choose the Patient (Patient Choice)                                                                                             |
| Determine Payers         | stage | Billing Order, Payer Checks, then Resolve Coverage for each insurance                                                                                                                            |
| Billing Order            | rule  | Keep Items Where Primary to Medicare (workers' compensation, auto, liability), then Has Priority (primary, secondary, tertiary), then Has Other Priority, joined, each once                      |
| Primary to Medicare      | rule  | The payer type is workers' compensation, automobile medical or liability, per insurance                                                                                                          |
| Has Priority             | rule  | The insurance has the billing priority given, per insurance                                                                                                                                      |
| Has Other Priority       | rule  | The insurance is not ranked primary, secondary or tertiary, per insurance                                                                                                                        |
| Payer Checks             | rule  | Medicare first on a work injury or transport accident, or without transport; an insurer payment method with no insurance reported                                                                |
| Transport Accident Cause | rule  | The cause of injury starts with V (ICD-10 V00 to V99), per cause                                                                                                                                 |
| Resolve Coverage         | stage | Find Payer → Found; Similar → task Match the Payer (Payer Choice); relationship from the Insured Relationships table                                                                             |
| Assign Charges           | stage | Charge Lines, then Price Line for each, and the total                                                                                                                                            |
| Charge Lines             | rule  | Base Rate Code, Line Modifiers and Covered Miles; the vehicle from the Vehicles table; mileage from the Mileage Codes table and A0888 for non-covered miles, for a transport                     |
| Base Rate Code           | rule  | A0998 without transport, else the Base Rate Codes table by the aircraft, or by level and emergency for ground; BLS when pronounced dead                                                          |
| Line Modifiers           | rule  | Origin and destination letters, QL when pronounced dead, GM when more than one patient was transported                                                                                           |
| Covered Miles            | rule  | Miles to the closest facility covered and the rest non-covered when the transport reason is B or C, else every loaded mile                                                                       |
| Price Line               | stage | Find Fee times units to the cent, or no price with the reason                                                                                                                                    |
| Review Claim             | stage | Task Review the Claim (permission `claims:approve`) → Record Claim Review: Approved, Held, or Superseded when the claim was revised                                                              |
| Claim Checks             | rule  | Signed Release, or Unable to Sign with a Facility Signature; a PCS for a non-emergency transport, no more than 60 days old; prior authorization for a dialysis transport; timely filing          |
| Signed Release           | rule  | A release for billing with a signed status, per signature                                                                                                                                        |
| Unable to Sign           | rule  | A release for billing the patient could not sign (unconscious, impaired and so on), per signature                                                                                                |
| Facility Signature       | rule  | Signed by a healthcare provider, per signature                                                                                                                                                   |
| Dialysis Diagnosis       | rule  | End-stage renal disease or dependence on dialysis, per diagnosis                                                                                                                                 |

## Customizing

| An agency wants                                                     | It overrides                                                            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| A different base rate or code                                       | The Base Rate Codes or Mileage Codes table, or its fee schedule         |
| A different code list (IV solutions, ALS2 procedures, dispositions) | The rule that holds it (IV Medication, ALS2 Procedure, a criteria rule) |
| Its own payer order                                                 | Billing Order                                                           |
| An extra charge (oxygen, a second attendant)                        | Charge Lines, adding a line from its own rule                           |
| Its own handling of one payer                                       | Resolve Coverage or Billing Order, branching on that payer              |
| Something after every claim                                         | Nothing: a new workflow on `claim.created`                              |

## Next

- **Documents in the PCR.** Attachments are already on the Encounter. An Extract Document service reads a facesheet or PCS into fields, a Document Facts rule merges them into the Encounter, and Save Encounter stores the result as a revision, so everything downstream reruns through `encounter.revised`.
- **The rest of the claim's life**, each as its own workflow from an event: check eligibility and discover insurance, check the claim, submit, acknowledgments, remittance and posting, denials and appeals, patient balance, close.
