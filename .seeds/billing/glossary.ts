import type { ExitDoc, PinSpec, Signature, ValueType, VariableDef } from '@ugula/graph';
import { graph as build } from '../builder.ts';

type Doc = { label: string; description: string };

const PINS: Record<string, Doc> = {
  answers: {
    label: 'Answers',
    description: 'What the biller answered in an earlier review of this report, if any.'
  },
  candidates: { label: 'Candidates', description: 'Existing patients that may be this person.' },
  claimId: { label: 'Claim', description: 'The claim being worked.' },
  context: { label: 'Task Details', description: 'What tasks show a biller about the claim.' },
  count: { label: 'Reports', description: 'How many reports the file held.' },
  coverageId: {
    label: 'Payer',
    description: 'The coverage (payer on the claim) this step is about.'
  },
  coverages: { label: 'Coverages', description: 'The payers, in billing order.' },
  demographics: {
    label: 'Demographics',
    description: 'The name, birth date, sex and address of the patient as reported.'
  },
  facts: {
    label: 'Encounter Facts',
    description:
      'The normalized trip, locations, patient, clinical, documentation and reported coverages of the report.'
  },
  file: { label: 'File', description: 'The stored file.' },
  fileId: { label: 'Payer File', description: 'The payer file record.' },
  force: {
    label: 'Ask Again',
    description: 'Ask every payer, even one already answered or waiting for an answer.'
  },
  fileName: { label: 'File Name', description: 'The name the file arrived with.' },
  findings: {
    label: 'Narrative Findings',
    description:
      'The medications and procedures the narrative documents, as read by the local model.'
  },
  kind: {
    label: 'Kind',
    description: 'What kind of file it is (835, TA1, 999, 277CA, 277 or 271).'
  },
  message: { label: 'Message', description: 'What a biller needs to know about the line.' },
  narrative: { label: 'Narrative', description: 'The narrative of the report.' },
  notes: { label: 'Notes', description: 'What limited the matching, for the biller.' },
  outcome: {
    label: 'Outcome',
    description: 'What happened to the line when the file was applied.'
  },
  patient: { label: 'Patient', description: 'The billing patient of the claim.' },
  patientName: { label: 'Patient Name', description: 'The patient name tasks show.' },
  payerNotes: { label: 'Payer Notes', description: 'What limited matching the payers.' },
  pcr: { label: 'PCR', description: 'The patient care report the claim is billed from.' },
  pcrNumber: { label: 'PCR Number', description: 'The PCR number of the report.' },
  reason: { label: 'Reason', description: 'Why, in words a biller reads.' },
  reference: { label: 'Reference', description: 'The claim number the line names.' },
  report: { label: 'Report', description: 'The stored patient care report the claim came from.' },
  reviews: { label: 'Reviews', description: 'How many lines a biller was asked to look at.' },
  runId: { label: 'Run', description: 'The workflow run that was started.' },
  runIds: { label: 'Runs', description: 'The Encounter to Claim run started for each report.' },
  sentAs: {
    label: 'Sent As',
    description: 'How the request was sent: realtime or the batch file name.'
  },
  service: {
    label: 'Service',
    description: 'The level of service, emergency status and loaded miles, with the reasons.'
  },
  statementCount: {
    label: 'Statements',
    description: 'How many patient statements the cycle sends.'
  },
  statementNumber: { label: 'Statement', description: 'Which patient statement this is.' },
  subject: { label: 'Task Subject', description: 'How tasks name the claim in task lists.' },
  trip: { label: 'Trip Summary', description: 'The trip as billers read it.' },
  tripType: {
    label: 'Trip Type',
    description: 'emergency, scheduled, treatNoTransport, refusal or noClaim.'
  }
};

const EXITS: Record<string, Doc> = {
  ...Object.fromEntries([['then', { label: 'Then', description: 'Done; the flow goes on.' }]]),
  done: { label: 'Done', description: 'The step is done; the cycle decides the next one.' },
  void: { label: 'Void', description: 'A biller voided the claim.' },
  voided: { label: 'Voided', description: 'A biller voided the claim.' },
  writeOff: { label: 'Write Off', description: 'A biller wrote off the balance.' },
  approved: { label: 'Approved', description: 'A biller approved the PCR review.' },
  claimed: { label: 'Claimed', description: 'The claim was built and its payer cycle started.' },
  skipped: { label: 'Skipped', description: 'No claim was needed, so the draft was voided.' },
  saved: { label: 'Saved', description: 'The claim was saved on the draft.' }
};

export const p = (name: string, type: ValueType, optional = false): PinSpec => {
  const doc = PINS[name];
  if (!doc) throw new Error(`Describe the pin "${name}" in the billing glossary`);
  return { name, type, ...doc, ...(optional ? { optional: true } : {}) };
};

const exitsOf = (names: string[], given: Record<string, ExitDoc> = {}) =>
  Object.fromEntries(
    names.map((n) => {
      const doc = given[n] ?? EXITS[n];
      if (!doc) throw new Error(`Describe the exit "${n}" in the billing glossary`);
      return [n, doc];
    })
  );

export const graph = (signature: Signature, variables: VariableDef[] = []) =>
  build({ ...signature, exits: exitsOf(signature.execOut, signature.exits) }, variables);

export const action = (inputs: PinSpec[], outputs: PinSpec[], execOut = ['then']) =>
  graph({ execIn: ['exec'], execOut, inputs, outputs });
