# Workflows

How billing is built on the engine: a few events start workflows, workflows are stages, stages are rules, and rules are primitives wired on the canvas. Only a handful of service nodes touch the outside world, and they all speak in typed records. Scope today is one path, from a NEMSIS XML file to a claim that needs review; everything later in the claim's life (submission, remittance, denials, patient balances) is rebuilt on the same model afterwards.

## Principles

1. **Records, not facts nodes.** Data moves as a few typed records (Encounter, Person, Location, Insurance, Claim, Charge Line). Each has one Break and one Make node with every field; a field that holds another record is a typed pin you Break again. Every field may be empty: the XML requires little, so rules never assume a field is there.
2. **Primitives decide.** Every choice (is it billable, what level, which payer first, which modifier) is drawn from conditions, choices, logic gates, math, lists and lookups, so a biller can read it and an agency can override it.
3. **Services only touch the world.** A service reads or writes a record, matches, parses or prices, and never decides anything a rule could. There are few, and each is named for what it does to which record (Read PCR File, Save Encounter, Find Patient, Save Claim).
4. **Small graphs, named by what they give.** A rule is a pure graph named for the decision it returns (Trip Classification, Level of Service), and returns its reasons. A stage is a graph with a way in, named by its verb (Resolve Patient, Assign Charges). A workflow is named by its job and starts from one event.
5. **Events join workflows.** A workflow ends by saving a record, and the database emits the event for the change in the same transaction, so the next workflow starts from it. No workflow calls a later one by name.
6. **Reference data in tables.** Code sets and code mappings are tables an agency edits as forms, and prices are its fee schedules; decisions on top of them are drawn.

## Palette

| Group      | Nodes                                                                                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Events     | The workflow's start, shown as the event it waits for (On PCR File Received, On Encounter Created) with the event's fields as pins, or On Schedule                                                 |
| Records    | Break and Make for Encounter, Times, Odometer, Person, Address, Location, Payment, Insurance, Medication, Procedure, Vital Signs, Signature, Crew Member, Attachment, Claim, Coverage, Charge Line |
| Primitives | Condition, Choose Value, And/Or/Not, compare, math, text, time, lists (Where, Keep Items Where, Run Rule for Each, Find Item Where), Lookup Table, Branch, Switch, For Each, Sequence              |
| Services   | Read PCR File, Read PCR, Save Encounter, Read Encounter, Find Patient, Save Patient, Find Payer, Find Fee, Save Claim                                                                              |
| Endings    | Return, Fail                                                                                                                                                                                       |
| Graphs     | Every rule, stage and workflow, called like a node                                                                                                                                                 |

## Records

**Encounter** is one patient care report, typed and named in billing terms instead of NEMSIS elements, with place codes turned into names. It is built in code from the report, because mapping hundreds of elements is parsing, not policy.

| Field                                                                                                                                    | Type                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `pcrNumber`, `revision`, `reportId`                                                                                                | `id<encounter>`, text, integer, `id<report>` (the stored report this copy was read from)                                                                                                                    |
| `incidentNumber`, `serviceType`, `unitNumber`, `callSign`, `responseMode`, `responseModifiers`                                           | text and NEMSIS codes                                                                                                                                                                                       |
| `incidentDisposition`, `unitDisposition`, `patientEvaluation`, `crewDisposition`, `transportDisposition`, `levelOfCare`, `transportMode` | NEMSIS codes                                                                                                                                                                                                |
| `destinationReasons`, `patientsAtScene`, `patientsTransported`                                                                           | codes, a code, an integer                                                                                                                                                                                   |
| `times`                                                                                                                                  | Times: call, notified, en route, at scene, at patient, left scene, at destination, transfer of care, back in service                                                                                        |
| `odometer`                                                                                                                               | Odometer: begin, scene, destination, end                                                                                                                                                                    |
| `patient`                                                                                                                                | Person                                                                                                                                                                                                      |
| `pickup`, `destination`                                                                                                                  | Location                                                                                                                                                                                                    |
| `complaint`, `primarySymptom`, `otherSymptoms`, `primaryImpression`, `secondaryImpressions`, `workRelated`, `injuryCauses`               | text and codes; the impressions are `code<icd10>`                                                                                                                                                           |
| `cardiacArrest`, `arrestOutcome`                                                                                                         | codes                                                                                                                                                                                                       |
| `medications`, `procedures`, `vitals`                                                                                                    | lists of Medication, Procedure and Vital Signs                                                                                                                                                              |
| `payment`                                                                                                                                | Payment: method, certification (statement, date, reason), transport reason, ambulance conditions, closest facility miles, ALS assessment, crew-reported service level, condition codes, prior authorization |
| `insurances`, `signatures`, `crew`                                                                                                       | lists of Insurance (as reported), Signature and Crew Member                                                                                                                                                 |
| `narrative`                                                                                                                              | text                                                                                                                                                                                                        |
| `attachments`                                                                                                                            | list of Attachment (document type, file type, name, stored file)                                                                                                                                            |

**Person** (name parts, birth date, age, sex and gender, phone, weight and an Address), **Address** (street, city named from its place code, county, state, ZIP), **Location** (name, type of place and an Address), **Insurance** (company ID and name, priority, group, member ID, insured name and relationship), **Claim** (encounter, patient, classification, service date, level, emergency, loaded miles, origin and destination letters, diagnoses, coverages, lines, total, reasons), **Coverage** (directory payer or reported name, member and group ID, X12 relationship, insured name) and **Charge Line** (HCPCS code, modifiers, units, unit and total price in cents) are the rest.

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

Read PCR File → For Each report → Try **Save PCR** (Read PCR → Save Encounter: Created, Revised or Unchanged) → count each outcome, and count a report that fails as Failed so the rest go on → Return the counts.

The API records the import and emits the event in one transaction; an upload is refused when no published workflow starts on it, so an agency can add its own workflow next to this one.

### Encounter to Claim (on `encounter.created`) and Encounter Revised (on `encounter.revised`)

Read Encounter → **Build Claim**: Trip Classification → Billable?

- No → Not Billable, with the classification and its reasons.
- Yes → Resolve Patient → Determine Payers → Assign Charges → Make Claim → Save Claim (Needs Review; a revised encounter replaces its claim).

| Graph                  | Kind  | Built from                                                                                                                                |
| ---------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Trip Classification    | rule  | Conditions on dispositions and service type: not billable, refusal, treated without transport, scheduled, emergency, the first that holds |
| Determine Service      | rule  | Service Date, Level of Service, Emergency Status, Loaded Miles                                                                            |
| Level of Service       | rule  | SCT, ALS2, ALS1 conditions on procedures (ALS2 Procedures table), IV/IO medications (IV Solutions table), ALS assessment, crew level; BLS |
| Emergency Status       | rule  | Response mode, or the call type or crew level when there is none                                                                          |
| Loaded Miles           | rule  | Destination less scene odometer, never below zero, rounded up to the tenth                                                                |
| Service Date           | rule  | The first time recorded: at patient, at scene, notified, call                                                                             |
| Assign Diagnoses       | rule  | Primary then secondary impressions, each once, at most twelve                                                                             |
| Origin and Destination | rule  | Origin from the pickup type or service type; destination from the Destination Letters table; neither unless both                          |
| Resolve Patient        | stage | Find Patient → Matched; Not Found → Save Patient; Similar → task Choose the Patient; Incomplete → task Complete the Patient               |
| Determine Payers       | stage | Billing Order, then Insurance Coverage for each insurance                                                                                 |
| Billing Order          | rule  | Primary, secondary, tertiary, then others                                                                                                 |
| Insurance Coverage     | stage | Find Payer → Found; Similar → task Match the Payer; relationship from the Insured Relationships table                                     |
| Assign Charges         | stage | Charge Lines, then Price Line for each, and the total                                                                                     |
| Charge Lines           | rule  | Base Rate Code, and A0425 for loaded miles of a transport, each with the origin and destination modifier                                  |
| Base Rate Code         | rule  | A0998 without transport, else the Base Rate Codes table by level and emergency                                                            |
| Price Line             | stage | Find Fee times units to the cent, or no price with the reason                                                                             |

## Customizing

| An agency wants                              | It overrides                                                 |
| -------------------------------------------- | ------------------------------------------------------------ |
| A different base rate or code                | The Base Rate Codes table or its fee schedule                |
| Its own payer order                          | Billing Order                                                |
| An extra charge (oxygen, a second attendant) | Charge Lines, adding a line from its own rule                |
| Its own handling of one payer                | Insurance Coverage or Billing Order, branching on that payer |
| Something after every claim                  | Nothing: a new workflow on `claim.created`                   |

## Next

- **Documents in the PCR.** Attachments are already on the Encounter. An Extract Document service reads a facesheet or PCS into fields, a Document Facts rule merges them into the Encounter, and Save Encounter stores the result as a revision, so everything downstream reruns through `encounter.revised`.
- **The rest of the claim's life**, each as its own workflow from an event: check eligibility and discover insurance, check the claim, submit, acknowledgments, remittance and posting, denials and appeals, patient balance, close.
