import { LEVEL_FIELD, LOADED_MILES_FIELD, TRIP_TYPE_FIELD, UNREAD_FINDINGS } from '@ugula/billing';
import type { GraphDef } from '@ugula/graph';
import { PCR_TYPE } from '@ugula/nemsis';
import { slot } from '../builder.ts';
import type { SeedGraph } from '../graphs.ts';
import { action, graph, p } from './glossary.ts';
import {
  ADDRESS_PINS,
  asRule,
  asStage,
  asWorkflow,
  d,
  expr,
  field,
  is,
  named,
  nameOf,
  P,
  placeOf,
  rule,
  shared,
  subject,
  summarize,
  T,
  table
} from './shared.ts';

const {
  blob: BLOB,
  demographics: DEMOGRAPHICS,
  patient: PATIENT,
  coverages: COVERAGES,
  service: SERVICE,
  findings: FINDINGS,
  facts: FACTS
} = T;

const CONFIRM_PATIENT_SUMMARY = `'Decide whether ' + ${named(nameOf('demographics?'), "'the patient on the report'")} +
  (${named('demographics?.birthDate', 'null')} != null ? ', born ' + demographics?.birthDate + ',' : '') +
  (len(candidates ?? []) <= 1 ? ' is an existing patient' : ' is one of ' + text(len(candidates ?? [])) + ' existing patients') +
  (${named('reason', 'null')} != null ? ' (' + reason + ')' : '') + ', or create a new patient'`;

const MISSING_DETAILS = `join(filter([
  (reported?.firstName ?? '') == '' ? 'first name' : null,
  (reported?.lastName ?? '') == '' ? 'last name' : null,
  (reported?.birthDate ?? '') == '' ? 'birth date' : null
], x => x != null), ', ')`;

const COMPLETE_PATIENT_SUMMARY = `${MISSING_DETAILS} == ''
  ? 'The patient name or birth date on the report is not valid; correct them so the patient can be matched or created'
  : 'The report has no patient ' + ${MISSING_DETAILS} + '; fill it in so the patient can be matched or created'`;

const MATCH_PAYER_SUMMARY = `'Link the reported payer "' + text(item?.payer) + '" to a directory payer' +
  (find(item?.candidates ?? [], c => c?.value == item?.suggested)?.label != null
    ? ' (likely ' + find(item?.candidates ?? [], c => c?.value == item?.suggested)?.label + ')'
    : '') +
  ', mark it unlisted, or remove it if it is not insurance'`;

const SERVICE_PARTS = `filter([
  { scheduled: 'scheduled trip', treatNoTransport: 'treat-no-transport', refusal: 'refusal', noClaim: 'no-claim trip' }[tripType ?? ''],
  service?.level,
  service?.emergency == true ? 'emergency' : service?.emergency == false ? 'non-emergency' : null,
  service?.loadedMiles != null ? text(round(service?.loadedMiles, 1)) + ' loaded miles' : null,
  service?.deceased == true ? 'pronounced dead before loading' : null
], x => x != null && x != '')`;

const REVIEW_PCR_SUMMARY = `len(${SERVICE_PARTS}) == 0
  ? 'Confirm the trip type, level of service and loaded miles before this claim is priced'
  : 'Confirm the service: ' + join(${SERVICE_PARTS}, ', ') +
    (len(findings?.medications ?? []) + len(findings?.procedures ?? []) > 0 ? ', suggested from the narrative' : '') +
    ', before this claim is priced'`;

const HELD_SUMMARY = `'This PCR is on hold' + (${named('note', 'null')} != null ? ': ' + note : '') +
  '; release it back to review once it is sorted out, or void it'`;

const REVISION_SUMMARY = `(context?.changes == null
  ? 'A newer version of this report arrived'
  : len(context?.changes) == 0
    ? 'A newer version of this report arrived with no changes to its billing details'
    : 'A newer version of this report changes the ' + join(map(slice(context?.changes, 0, 3), x => lower(x.field)), ', ') +
      (len(context?.changes) > 3 ? ' and ' + text(len(context?.changes) - 3) + ' more' : '')) +
  (context?.canApply == true
    ? '; apply it, acknowledge it or void the claim'
    : '; the claim is ' + (context?.status != null ? replace(context?.status, '_', ' ') : 'past review') +
      ', so correct it on its claim page or acknowledge it')`;

const ORPHAN_SUMMARY = `'This draft claim stopped before it was ready' +
  (${named('reason', 'null')} != null ? ' (' + reason + ')' : '') + '; restart it from its report or void it'`;

const SEX = "{ F: 'Female', M: 'Male', U: 'Unknown' }";

const TRIP = `{
  pcrNumber: pcr.pcrNumber,
  tripType: tripType,
  classifiedBy: reason,
  calledAt: pcr.times.psapCall,
  response: {
    '2223001': 'Emergent',
    '2223003': 'Emergent, downgraded to non-emergent',
    '2223005': 'Non-emergent',
    '2223007': 'Non-emergent, upgraded to emergent'
  }[pcr.response.responseMode ?? ''] ?? pcr.response.responseMode,
  careProvided: {
    '4232001': 'BLS',
    '4232003': 'ALS',
    '4232005': 'ALS',
    '4232009': 'Critical care'
  }[pcr.disposition.levelOfCare ?? ''] ?? pcr.disposition.levelOfCare,
  primaryImpression: pcr.situation.primaryImpression,
  otherImpressions: pcr.situation.secondaryImpressions,
  pickup: ${placeOf('pcr.scene')},
  destination: join(filter([pcr.disposition.destinationName, ${placeOf('pcr.disposition')}], x => x != null && x != ''), ' · ')
}`;

const REVIEW_CONTEXT = `{
  patient: {
    name: ${nameOf('patient')},
    birthDate: patient.birthDate,
    sex: ${SEX}[patient.gender ?? ''] ?? null,
    address: ${placeOf('patient')}
  },
  trip: trip,
  coverage: map(coverages, c => {
    payer: c.payer,
    directory: c.directoryName ?? 'Not linked to the payer directory',
    memberId: c.memberId,
    groupId: c.groupId
  }),
  narrative: {
    medications: map(findings.medications, m =>
      m.medication + ' ' + m.route + (m.doses > 1 ? ' x' + text(m.doses) : '')),
    procedures: findings.procedures
  },
  condition: {
    complaint: pcr.situation.complaint,
    primarySymptom: pcr.situation.primarySymptom,
    vitals: map(pcr.vitals, v => join(filter([
      v.takenAt,
      v.systolic != null ? 'BP ' + text(v.systolic) + '/' + text(v.diastolic ?? '?') : null,
      v.heartRate != null ? 'HR ' + text(v.heartRate) : null,
      v.respiratoryRate != null ? 'RR ' + text(v.respiratoryRate) : null,
      v.pulseOximetry != null ? 'SpO2 ' + text(v.pulseOximetry) + '%' : null,
      v.bloodGlucose != null ? 'BGL ' + text(v.bloodGlucose) : null,
      v.glasgowComaScore != null ? 'GCS ' + text(v.glasgowComaScore) : null
    ], x => x != null && x != ''), ' · ')),
    proceduresCoded: map(pcr.procedures, x => x.procedure)
  },
  documentation: {
    signature: documentation.signature,
    signatureNote: documentation.signatureNote,
    physicianCertification: documentation.pcsOnFile,
    transportReason: documentation.transportReason,
    conditionCodes: documentation.conditionCodes,
    patientsTransported: documentation.patientCount,
    mspAccident: documentation.mspAccident
  },
  suggested: service,
  warnings: concat(
    reason == null ? ['No disposition or type of service is recorded, so the trip was classified as an emergency transport'] : [],
    documentation.signature == 'signed' ? [] : [documentation.signatureNote ?? 'No billing signature'],
    tripType == 'scheduled' && documentation.pcsOnFile != true ? ['This scheduled trip has no physician certification statement'] : [],
    len(pcr.vitals ?? []) == 0 ? ['No vital signs are recorded to support medical necessity'] : [],
    service.deceased == true ? ['The patient was pronounced dead before loading, so the trip is billed as BLS with QL and no mileage'] : [],
    (service.nonCoveredMiles ?? 0) > 0 ? [text(service.nonCoveredMiles) + ' miles past the closest hospital are billed as non-covered (A0888)'] : [],
    (documentation.patientCount ?? 1) > 1 ? [text(documentation.patientCount) + ' patients rode on this trip, so its lines carry GM'] : [],
    findings.notes,
    payerNotes
  )
}`;

const PATIENT_REVIEW_CONTEXT = `{
  reason: reason,
  report: {
    name: ${nameOf('demographics')},
    birthDate: demographics.birthDate,
    sex: ${SEX}[demographics.gender ?? ''] ?? null,
    address: ${placeOf('demographics')},
    pcrNumber: pcrNumber
  },
  candidates: map(candidates, c => {
    name: ${nameOf('c')},
    birthDate: c.birthDate,
    sex: ${SEX}[c.gender ?? ''] ?? null,
    address: ${placeOf('c')}
  })
}`;

const PATIENT_CHOICES = `{
  patientId: map(candidates, c => {
    value: c.id,
    label: c.lastName + ', ' + c.firstName + ' · born ' + c.birthDate +
      (c.postalCode ? ' · ' + c.postalCode : '')
  })
}`;

const reviewPatientMatch = (): GraphDef => {
  const g = action(
    [
      p('demographics', DEMOGRAPHICS),
      p('candidates', { list: PATIENT }),
      p('reason', 'string', true),
      p('pcrNumber', 'string', true)
    ],
    [p('patient', PATIENT)]
  );
  g.add('choices', 'std.expr', expr('Candidate Choices', PATIENT_CHOICES));
  g.add('pick', 'std.expr', expr('Likeliest Candidate', '{ patientId: candidates[0].id }'));
  g.add('context', 'std.expr', expr('Review Context', PATIENT_REVIEW_CONTEXT));
  g.add('subject', 'std.expr', subject('pcrNumber', nameOf('demographics')));
  g.add('confirm', 'std.human.task', {
    label: 'Confirm Patient',
    config: {
      title: 'Confirm patient',
      queue: 'billing-patients',
      instructions:
        'Use the candidate that is this person, or create a new patient from the report when none of them is.',
      fields: [
        {
          name: 'patientId',
          type: 'string',
          label: 'Candidate patient',
          required: ['useSelected']
        }
      ],
      outcomes: ['useSelected', 'createNew']
    }
  });
  g.add('createNew', 'billing.create-patient', { label: 'Create New Patient' });
  g.add('find', 'billing.find-patient');
  g.ret('reviewed');
  g.ret('linked');
  g.wire('entry.exec', 'confirm.exec');
  g.wire('entry.candidates', 'choices.candidates', 'pick.candidates', 'context.candidates');
  g.wire('entry.reason', 'context.reason');
  g.wire('entry.demographics', 'context.demographics', 'subject.demographics');
  g.wire('entry.demographics', 'createNew.demographics');
  g.wire('entry.pcrNumber', 'context.pcrNumber', 'subject.pcrNumber');
  g.wire('choices.result', 'confirm.options');
  g.wire('pick.result', 'confirm.defaults');
  g.wire('context.result', 'confirm.context');
  g.wire('subject.result', 'confirm.subject');
  summarize(g, 'confirm', CONFIRM_PATIENT_SUMMARY, {
    candidates: 'entry.candidates',
    demographics: 'entry.demographics',
    reason: 'entry.reason'
  });
  g.wire('confirm.useSelected', 'find.exec');
  g.wire('confirm.patientId', 'find.patientId');
  g.wire('find.missing', 'confirm.exec');
  g.wire('confirm.createNew', 'createNew.exec');
  g.wire('createNew.invalid', 'confirm.exec');
  g.wire('createNew.created', 'reviewed.exec');
  g.wire('createNew.patient', 'reviewed.patient');
  g.wire('find.found', 'linked.exec');
  g.wire('find.patient', 'linked.patient');
  return g.def;
};

const resolvePatient = (): GraphDef => {
  const g = graph(
    {
      execIn: ['exec'],
      execOut: ['then'],
      inputs: [p('demographics', DEMOGRAPHICS), p('pcrNumber', 'string', true)],
      outputs: [p('patient', PATIENT)]
    },
    [{ name: 'entered', type: DEMOGRAPHICS, default: null }]
  );
  g.add('match', 'billing.match-patient');
  g.add('create', 'billing.create-patient', { values: { reuseMatch: true } });
  g.add('review', 'billing.review-patient-match', { label: 'Review Likely Matches' });
  g.add('context', 'std.expr', expr('Report Context', PATIENT_REVIEW_CONTEXT));
  g.add('subject', 'std.expr', subject('pcrNumber', nameOf('demographics')));
  g.add('entered', 'std.var.get', { label: 'Details Entered Before', config: { name: 'entered' } });
  g.add('prefill', 'std.logic.coalesce', { label: 'Entered Before, Else the Report' });
  g.add('complete', 'std.human.task', {
    label: 'Complete Patient Details',
    config: {
      title: 'Complete patient details',
      queue: 'billing-patients',
      instructions:
        'The report is missing the name or birth date needed to find or create a patient, or one of them is not valid. Fill them in from the report, and the patient is matched or created from them.',
      fields: [
        { name: 'firstName', type: 'string', label: 'First name', required: ['savePatient'] },
        { name: 'lastName', type: 'string', label: 'Last name', required: ['savePatient'] },
        {
          name: 'birthDate',
          type: 'string',
          label: 'Birth date',
          format: 'date',
          required: ['savePatient']
        }
      ],
      outcomes: ['savePatient']
    }
  });
  g.add('reported', 'billing.demographics.break', { label: 'Cleaned Demographics' });
  g.add('corrected', 'billing.demographics.make', { label: 'Completed Demographics' });
  g.add('remember', 'std.var.set', { label: 'Remember the Details', config: { name: 'entered' } });
  g.add('rematch', 'billing.match-patient', { label: 'Match Completed Patient' });
  g.add('createCompleted', 'billing.create-patient', {
    label: 'Create Completed Patient',
    values: { reuseMatch: true }
  });
  g.add('reviewCompleted', 'billing.review-patient-match', {
    label: 'Review Completed Matches'
  });
  for (const id of [
    'matched',
    'created',
    'reviewed',
    'completedMatched',
    'completedCreated',
    'completedReviewed'
  ]) {
    g.ret(id);
  }
  g.wire('entry.exec', 'match.exec');
  g.wire('entry.demographics', 'match.demographics', 'create.demographics');
  g.wire('entry.demographics', 'subject.demographics');
  g.wire('entry.pcrNumber', 'review.pcrNumber', 'reviewCompleted.pcrNumber');
  g.wire('entry.pcrNumber', 'context.pcrNumber', 'subject.pcrNumber');
  g.wire('match.matched', 'matched.exec');
  g.wire('match.patient', 'matched.patient');
  g.wire('match.unmatched', 'create.exec');
  g.wire('create.created', 'created.exec');
  g.wire('create.invalid', 'complete.exec');
  g.wire('create.patient', 'created.patient');
  g.wire('match.review', 'review.exec');
  g.wire('match.candidates', 'review.candidates', 'context.candidates');
  g.wire('match.reason', 'review.reason', 'context.reason');
  g.wire('match.demographics', 'review.demographics', 'context.demographics');
  g.wire('review.then', 'reviewed.exec');
  g.wire('review.patient', 'reviewed.patient');
  g.wire('match.incomplete', 'complete.exec');
  g.wire('context.result', 'complete.context');
  g.wire('subject.result', 'complete.subject');
  g.wire('entered.value', 'prefill.value');
  g.wire('match.demographics', 'prefill.fallback', 'reported.demographics');
  g.wire('prefill.result', 'complete.defaults');
  summarize(g, 'complete', COMPLETE_PATIENT_SUMMARY, { reported: 'prefill.result' });
  for (const pin of ['gender', ...ADDRESS_PINS]) {
    g.wire(`reported.${pin}`, `corrected.${pin}`);
  }
  for (const pin of ['firstName', 'lastName', 'birthDate']) {
    g.wire(`complete.${pin}`, `corrected.${pin}`);
  }
  g.wire('complete.savePatient', 'remember.exec');
  g.wire('corrected.demographics', 'remember.value');
  g.wire('remember.then', 'rematch.exec');
  g.wire('corrected.demographics', 'rematch.demographics');
  g.wire('rematch.matched', 'completedMatched.exec');
  g.wire('rematch.patient', 'completedMatched.patient');
  g.wire('rematch.unmatched', 'createCompleted.exec');
  g.wire('rematch.demographics', 'createCompleted.demographics', 'reviewCompleted.demographics');
  g.wire('createCompleted.created', 'completedCreated.exec');
  g.wire('createCompleted.invalid', 'complete.exec');
  g.wire('createCompleted.patient', 'completedCreated.patient');
  g.wire('rematch.review', 'reviewCompleted.exec');
  g.wire('rematch.candidates', 'reviewCompleted.candidates');
  g.wire('rematch.reason', 'reviewCompleted.reason');
  g.wire('reviewCompleted.then', 'completedReviewed.exec');
  g.wire('reviewCompleted.patient', 'completedReviewed.patient');
  g.wire('rematch.incomplete', 'complete.exec');
  return g.def;
};

const resolvePayers = (): GraphDef => {
  const g = graph(
    {
      execIn: ['exec'],
      execOut: ['then'],
      inputs: [
        p('coverages', COVERAGES),
        p('pcrNumber', 'string', true),
        p('patientName', 'string', true)
      ],
      outputs: [p('coverages', COVERAGES), p('notes', { list: 'string' })]
    },
    [{ name: 'removed', type: { list: 'string' }, default: [] }]
  );
  g.add('match', 'billing.match-payers');
  g.add(
    'byName',
    'std.expr',
    expr(
      'One Task per Payer Name',
      'map(values(groupBy(unmatched, x => lower(x.payer))), g => merge(first(g), { keys: map(g, x => x.key) }))'
    )
  );
  g.add('each', 'std.flow.for-each', { label: 'Each Unlinked Payer Name' });
  g.add(
    'choices',
    'std.expr',
    expr('Directory Choices', 'len(item.candidates) > 0 ? { payerId: item.candidates } : null')
  );
  g.add('suggestion', 'std.expr', expr('Suggested Payer', '{ payerId: item.suggested }'));
  g.add(
    'context',
    'std.expr',
    expr(
      'Payer Context',
      '{ reportedPayer: item.payer, memberId: item.memberId, patient: patientName, pcrNumber: pcrNumber, notes: item.notes }'
    )
  );
  g.add('confirm', 'std.human.task', {
    label: 'Match Payer',
    config: {
      title: 'Match payer',
      queue: 'billing-payers',
      instructions:
        'The report names a payer that is not in the payer directory by that name. Choose the directory payer it means, and later reports with this name link automatically; similar payers come first with how close they are. Mark it unlisted when the payer is real but not in the directory yet, or remove it when it is not insurance (self pay, unknown).',
      fields: [{ name: 'payerId', type: 'string', label: 'Directory payer', required: ['link'] }],
      outcomes: ['link', 'unlisted', 'remove']
    }
  });
  g.add('reported', 'std.object.get', { label: 'Reported Name', values: { path: 'payer' } });
  g.add('keys', 'std.object.get', { label: 'Coverage Keys', values: { path: 'keys' } });
  g.add('subject', 'std.expr', subject('pcrNumber', 'item.payer'));
  g.add('link', 'billing.link-payer', { label: 'Remember Payer Name' });
  g.add('leaveOut', 'std.expr', expr('Coverages Left Out', 'concat(removed, keys)'));
  g.add('remove', 'std.var.set', {
    label: 'Leave Out the Coverages With This Name',
    config: { name: 'removed' }
  });
  g.add('removed', 'std.var.get', { config: { name: 'removed' } });
  g.add('rematch', 'billing.match-payers', {
    label: 'Match Reviewed Payers',
    values: { suggest: false }
  });
  g.ret('matched');
  g.ret('reviewed');
  g.wire('entry.exec', 'match.exec');
  g.wire('entry.coverages', 'match.coverages', 'rematch.coverages');
  g.wire('match.matched', 'matched.exec');
  g.wire('match.coverages', 'matched.coverages');
  g.wire('match.notes', 'matched.notes');
  g.wire('match.review', 'each.exec');
  g.wire('match.unmatched', 'byName.unmatched');
  g.wire('byName.result', 'each.list');
  g.wire('each.body', 'confirm.exec');
  g.wire('each.item', 'choices.item', 'suggestion.item', 'context.item', 'subject.item');
  g.wire('each.item', 'reported.object', 'keys.object');
  g.wire('entry.pcrNumber', 'context.pcrNumber', 'subject.pcrNumber');
  g.wire('entry.patientName', 'context.patientName');
  g.wire('choices.result', 'confirm.options');
  g.wire('suggestion.result', 'confirm.defaults');
  g.wire('context.result', 'confirm.context');
  g.wire('subject.result', 'confirm.subject');
  summarize(g, 'confirm', MATCH_PAYER_SUMMARY, { item: 'each.item' });
  g.wire('confirm.link', 'link.exec');
  g.wire('reported.value', 'link.name');
  g.wire('confirm.payerId', 'link.payerId');
  g.wire('link.invalid', 'confirm.exec');
  g.wire('confirm.remove', 'remove.exec');
  g.wire('keys.value', 'leaveOut.keys');
  g.wire('leaveOut.result', 'remove.value');
  g.wire('removed.value', 'rematch.exclude', 'leaveOut.removed');
  g.wire('each.completed', 'rematch.exec');
  g.wire('rematch.matched', 'reviewed.exec');
  g.wire('rematch.review', 'reviewed.exec');
  g.wire('rematch.coverages', 'reviewed.coverages');
  g.wire('match.notes', 'reviewed.notes');
  return g.def;
};

const REVIEW_FIELDS = [
  { ...TRIP_TYPE_FIELD, required: ['approve'] },
  { ...LEVEL_FIELD, required: ['approve'] },
  { name: 'emergency', type: 'boolean', label: 'Emergency response' },
  LOADED_MILES_FIELD,
  { name: 'note', type: 'string', label: 'Note' }
];

const REVISION_CONTEXT = `{
  claimId: claimId,
  status: status,
  canApply: some(['draft', 'needs_review', 'void'], s => s == status),
  patient: { name: ${nameOf('pcr.patient')}, birthDate: pcr.patient.birthDate },
  trip: trip,
  changes: previous == null ? null : filter([
    { field: 'Patient name', was: ${nameOf('previous.patient')}, now: ${nameOf('pcr.patient')} },
    { field: 'Birth date', was: previous.patient.birthDate, now: pcr.patient.birthDate },
    { field: 'Patient address', was: ${placeOf('previous.patient')}, now: ${placeOf('pcr.patient')} },
    { field: 'Call time', was: previous.times.psapCall, now: pcr.times.psapCall },
    { field: 'Pickup', was: ${placeOf('previous.scene')}, now: ${placeOf('pcr.scene')} },
    { field: 'Destination', was: ${placeOf('previous.disposition')}, now: ${placeOf('pcr.disposition')} },
    { field: 'Primary impression', was: previous.situation.primaryImpression, now: pcr.situation.primaryImpression },
    { field: 'Other impressions', was: join(previous.situation.secondaryImpressions ?? [], ', '), now: join(pcr.situation.secondaryImpressions ?? [], ', ') },
    { field: 'Level of care', was: previous.disposition.levelOfCare, now: pcr.disposition.levelOfCare },
    { field: 'Response mode', was: previous.response.responseMode, now: pcr.response.responseMode },
    { field: 'Scene odometer', was: previous.response.sceneOdometer, now: pcr.response.sceneOdometer },
    { field: 'Destination odometer', was: previous.response.destinationOdometer, now: pcr.response.destinationOdometer },
    { field: 'Payers', was: join(map(previous.insurances ?? [], i => i.companyName ?? ''), ', '), now: join(map(pcr.insurances ?? [], i => i.companyName ?? ''), ', ') },
    { field: 'Narrative', was: len(previous.narrative ?? ''), now: len(pcr.narrative ?? '') }
  ], d => d.was != d.now)
}`;

const pcrSubject = (): GraphDef => {
  const g = rule([p('pcr', PCR_TYPE)], [p('subject', 'string')]);
  g.add('subject', 'std.expr', subject('pcr.pcrNumber', nameOf('pcr.patient')));
  g.ret('return');
  g.wire('entry.pcr', 'subject.pcr');
  g.wire('subject.result', 'return.subject');
  return g.def;
};

const tripSummary = (): GraphDef => {
  const g = rule(
    [p('pcr', PCR_TYPE), p('tripType', 'string', true), p('reason', 'string', true)],
    [p('trip', { object: {} })]
  );
  g.add('trip', 'std.expr', expr('Trip Summary', TRIP));
  g.ret('return');
  g.wire('entry.pcr', 'trip.pcr');
  g.wire('entry.tripType', 'trip.tripType');
  g.wire('entry.reason', 'trip.reason');
  g.wire('trip.result', 'return.trip');
  return g.def;
};

const readFindings = (): GraphDef => {
  const g = graph(
    {
      execIn: ['exec'],
      execOut: ['then'],
      inputs: [p('narrative', 'string', true)],
      outputs: [p('findings', FINDINGS)]
    },
    [{ name: 'findings', type: FINDINGS, default: UNREAD_FINDINGS }]
  );
  g.add('try', 'std.flow.try', { label: 'Read the Narrative If the Model Is Up' });
  g.add('read', 'billing.read-narrative', { retry: { max: 3, delayMs: 30_000, factor: 4 } });
  g.add('keep', 'std.var.set', { label: 'Keep the Findings', config: { name: 'findings' } });
  g.add('findings', 'std.var.get', { label: 'Findings', config: { name: 'findings' } });
  g.ret('done');
  g.wire('entry.exec', 'try.exec');
  g.wire('try.try', 'read.exec');
  g.wire('entry.narrative', 'read.narrative');
  g.wire('read.then', 'keep.exec');
  g.wire('read.findings', 'keep.value');
  g.wire('try.then', 'done.exec');
  g.wire('try.catch', 'done.exec');
  g.wire('findings.value', 'done.findings');
  return g.def;
};

const claimPatient = (): GraphDef => {
  const g = action(
    [p('demographics', DEMOGRAPHICS), p('pcrNumber', 'string', true), p('claimId', 'string')],
    [p('patient', PATIENT)]
  );
  g.add('resolve', 'billing.resolve-patient', { label: 'Resolve Patient' });
  g.add('address', 'billing.update-patient-address', { label: 'Current Patient Address' });
  g.add('assign', 'billing.assign-patient', { label: 'Assign Patient to Claim' });
  g.ret('done');
  g.wire('entry.exec', 'resolve.exec');
  g.wire('entry.demographics', 'resolve.demographics', 'address.demographics');
  g.wire('entry.pcrNumber', 'resolve.pcrNumber');
  g.wire('resolve.then', 'address.exec');
  g.wire('resolve.patient', 'address.patient');
  g.wire('address.then', 'assign.exec');
  g.wire('address.patient', 'assign.patient', 'done.patient');
  g.wire('entry.claimId', 'assign.claimId');
  g.wire('assign.then', 'done.exec');
  return g.def;
};

const REVIEW_ANSWERS = ['tripType', 'level', 'emergency', 'loadedMiles', 'note'];

const reviewPcr = (): GraphDef => {
  const g = graph(
    {
      execIn: ['exec'],
      execOut: ['approved', 'voided'],
      inputs: [
        p('pcr', PCR_TYPE),
        p('facts', FACTS),
        p('tripType', 'string'),
        p('reason', 'string', true),
        p('patient', PATIENT),
        p('coverages', COVERAGES),
        p('payerNotes', { list: 'string' }),
        p('findings', FINDINGS),
        p('service', SERVICE),
        p('answers', { object: {} }, true)
      ],
      outputs: [
        p('tripType', 'string', true),
        p('service', SERVICE, true),
        p('answers', { object: {} }, true)
      ]
    },
    [{ name: 'answers', type: { object: {} }, default: null }]
  );
  g.add('start', 'std.var.set', { label: 'Answers Given Before', config: { name: 'answers' } });
  g.add('answers', 'std.var.get', { label: 'Answers So Far', config: { name: 'answers' } });
  g.add('trip', 'billing.trip-summary', { label: 'Trip Summary' });
  g.add('subject', 'billing.pcr-subject', { label: 'Task Subject' });
  g.add('facts', 'billing.encounter-facts.break');
  g.add('reasonForTransport', 'billing.transport-reason', { label: 'Transport Reason' });
  g.add('documentation', 'std.object.set', {
    label: 'Documentation With the Transport Reason',
    values: { path: 'transportReason' }
  });
  g.add('context', 'std.expr', expr('Review Context', REVIEW_CONTEXT));
  g.add(
    'defaults',
    'std.expr',
    expr(
      'Answers Before, Else the Suggestion',
      'merge(service, { tripType: tripType }, fromEntries(filter(entries(answers ?? {}), e => e.value != null)))'
    )
  );
  g.add('review', 'std.human.task', {
    label: 'Review PCR',
    config: {
      title: 'Review PCR',
      queue: 'billing-review',
      instructions:
        'Check the patient, payers and impression codes, and confirm the trip type, level of service and loaded miles before this claim is priced. The suggestion lists what supports it, including what the narrative documents; warnings say what could not be read or decided.',
      fields: REVIEW_FIELDS,
      outcomes: ['approve', 'hold']
    }
  });
  g.add('given', 'std.object.make', {
    label: 'Answers',
    config: {
      fields: [
        { name: 'tripType', type: 'string' },
        { name: 'level', type: 'string' },
        { name: 'emergency', type: 'boolean' },
        { name: 'loadedMiles', type: 'number' },
        { name: 'note', type: 'string' }
      ]
    }
  });
  g.add('remember', 'std.var.set', { label: 'Remember the Answers', config: { name: 'answers' } });
  g.add(
    'holdContext',
    'std.expr',
    expr('Hold Context', `{ note: note, patient: ${nameOf('patient')}, trip: trip }`)
  );
  g.add('held', 'std.human.task', {
    label: 'Held PCR',
    config: {
      title: 'Held PCR',
      queue: 'billing-holds',
      instructions:
        'A reviewer held this PCR. Release it back to review once the report is sorted out, or void it so it is never billed.',
      outcomes: ['release', 'void']
    }
  });
  g.add('suggested', 'billing.service.break', { label: 'Suggested Service' });
  g.add('level', 'std.logic.coalesce', { label: 'Confirmed Level' });
  g.add('emergency', 'std.logic.coalesce', { label: 'Confirmed Emergency' });
  g.add('miles', 'std.logic.coalesce', { label: 'Confirmed Loaded Miles' });
  g.add('nonCovered', 'billing.non-covered-miles', { label: 'Non-Covered Miles' });
  g.add(
    'nonCoveredUnlessDead',
    'std.expr',
    expr('No Non-Covered Miles When Pronounced Dead', 'deceased == true ? null : miles')
  );
  g.add('confirmed', 'billing.service.make', { label: 'Confirmed Service' });
  g.ret('approvedDone', 'approved');
  g.ret('voidedDone', 'voided');

  g.wire('entry.exec', 'start.exec');
  g.wire('entry.answers', 'start.value');
  g.wire('start.then', 'review.exec');
  g.wire('entry.pcr', 'trip.pcr', 'subject.pcr', 'context.pcr');
  g.wire('entry.facts', 'facts.facts');
  g.wire('facts.documentation', 'reasonForTransport.documentation', 'documentation.object');
  g.wire('facts.locations', 'reasonForTransport.locations');
  g.wire('reasonForTransport.transportReason', 'documentation.value');
  g.wire('documentation.object', 'context.documentation');
  g.wire('entry.tripType', 'trip.tripType', 'defaults.tripType', 'context.tripType');
  g.wire('entry.reason', 'trip.reason', 'context.reason');
  g.wire('trip.trip', 'context.trip', 'holdContext.trip');
  g.wire('entry.patient', 'context.patient', 'holdContext.patient');
  g.wire('entry.coverages', 'context.coverages');
  g.wire('entry.payerNotes', 'context.payerNotes');
  g.wire('entry.findings', 'context.findings');
  g.wire('entry.service', 'context.service', 'defaults.service', 'suggested.service');
  g.wire('answers.value', 'defaults.answers');
  g.wire('defaults.result', 'review.defaults');
  g.wire('context.result', 'review.context');
  summarize(g, 'review', REVIEW_PCR_SUMMARY, {
    service: 'entry.service',
    tripType: 'entry.tripType',
    findings: 'entry.findings'
  });
  g.wire('subject.subject', 'review.subject', 'held.subject');
  for (const pin of REVIEW_ANSWERS) g.wire(`review.${pin}`, `given.${pin}`);

  g.wire('review.hold', 'remember.exec');
  g.wire('given.object', 'remember.value', 'approvedDone.answers');
  g.wire('remember.then', 'held.exec');
  g.wire('review.note', 'holdContext.note');
  g.wire('holdContext.result', 'held.context');
  summarize(g, 'held', HELD_SUMMARY, { note: 'review.note' });
  g.wire('held.release', 'review.exec');
  g.wire('held.void', 'voidedDone.exec');

  g.wire('review.approve', 'approvedDone.exec');
  g.wire('review.tripType', 'approvedDone.tripType');
  g.wire('review.level', 'level.value');
  g.wire('suggested.level', 'level.fallback');
  g.wire('review.emergency', 'emergency.value');
  g.wire('suggested.emergency', 'emergency.fallback');
  g.wire('level.result', 'confirmed.level');
  g.wire('emergency.result', 'confirmed.emergency');
  g.wire('review.loadedMiles', 'miles.value');
  g.wire('suggested.loadedMiles', 'miles.fallback');
  g.wire('miles.result', 'confirmed.loadedMiles', 'nonCovered.loadedMiles');
  g.wire('entry.facts', 'nonCovered.facts');
  g.wire('suggested.deceased', 'confirmed.deceased', 'nonCoveredUnlessDead.deceased');
  g.wire('nonCovered.nonCoveredMiles', 'nonCoveredUnlessDead.miles');
  g.wire('nonCoveredUnlessDead.result', 'confirmed.nonCoveredMiles');
  g.wire('suggested.basis', 'confirmed.basis');
  g.wire('confirmed.service', 'approvedDone.service');
  return g.def;
};

const startCycle = (): GraphDef => {
  const g = action([p('claimId', 'string')], [p('runId', 'string')]);
  g.add('inputs', 'std.object.make', {
    label: 'Cycle Inputs',
    config: { fields: [{ name: 'claimId', type: 'string' }] }
  });
  g.add('cycle', 'std.flow.start-workflow', {
    label: 'Start Payer Cycle',
    config: { workflow: 'billing.cycle-claim', version: 1 }
  });
  g.add('attach', 'billing.attach-cycle', { label: 'Link Claim to Its Cycle' });
  g.ret('done');
  g.wire('entry.exec', 'cycle.exec');
  g.wire('entry.claimId', 'inputs.claimId', 'attach.claimId');
  g.wire('inputs.object', 'cycle.inputs');
  g.wire('cycle.then', 'attach.exec');
  g.wire('cycle.runId', 'attach.cycleRunId', 'done.runId');
  g.wire('attach.then', 'done.exec');
  return g.def;
};

const reworkClaim = (): GraphDef => {
  const g = action([p('report', BLOB, true), p('claimId', 'string')], [p('runId', 'string')]);
  g.add('inputs', 'std.object.make', {
    label: 'Run Inputs',
    config: {
      fields: [
        { name: 'report', type: BLOB },
        { name: 'claimId', type: 'string' }
      ]
    }
  });
  g.add('restart', 'std.flow.start-workflow', {
    label: 'Work the Claim From Its Report',
    config: { workflow: 'billing.encounter-to-claim', version: 1 }
  });
  g.ret('done');
  g.wire('entry.exec', 'restart.exec');
  g.wire('entry.report', 'inputs.report');
  g.wire('entry.claimId', 'inputs.claimId');
  g.wire('inputs.object', 'restart.inputs');
  g.wire('restart.then', 'done.exec');
  g.wire('restart.runId', 'done.runId');
  return g.def;
};

const reviewRevision = (): GraphDef => {
  const g = graph(
    {
      execIn: ['exec'],
      execOut: ['then'],
      inputs: [p('report', BLOB), p('claimId', 'string'), p('pcr', PCR_TYPE)],
      outputs: []
    },
    [{ name: 'previous', type: PCR_TYPE, default: null }]
  );
  g.add('note', 'billing.note-revision');
  g.add('hasPrevious', 'std.logic.is-null', { label: 'No Earlier Report' });
  g.add('first', 'std.flow.branch', { label: 'Compare With the Earlier Report?' });
  g.add('readPrevious', 'nemsis.read-report', { label: 'Read the Earlier Report' });
  g.add('keep', 'std.var.set', { label: 'Earlier Report', config: { name: 'previous' } });
  g.add('previous', 'std.var.get', { label: 'Earlier PCR', config: { name: 'previous' } });
  g.input('pcr', 'pcr');
  g.input('contextClaimId', 'claimId');
  g.add('facts', 'billing.map-encounter-facts', { label: 'Map Encounter Facts' });
  g.add('classify', 'billing.classify-trip', { label: 'Classify Trip' });
  g.add('trip', 'billing.trip-summary', { label: 'Trip Summary' });
  g.add('subject', 'billing.pcr-subject', { label: 'Task Subject' });
  g.add('context', 'std.expr', expr('Revision Context', REVISION_CONTEXT));
  g.add('canApply', 'std.object.get', { label: 'Can Apply', values: { path: 'canApply' } });
  g.add('revision', 'std.human.task', {
    label: 'Review Updated PCR',
    config: {
      title: 'Review updated PCR',
      queue: 'billing-review',
      instructions:
        'A newer version of this patient care report arrived after its claim was opened, so it was not billed again; the changes list what differs from the report the claim came from. Apply works the claim again from the new report while it is a draft, needs review or is void; a claim already on its way to payers is corrected on its claim page. Acknowledge keeps the claim as it is; Void closes it, only while it has not gone to payers.',
      outcomes: ['apply', 'acknowledge', 'void']
    }
  });
  g.add('applies', 'std.flow.branch', { label: 'Can It Be Worked Again?' });
  g.add('voidable', 'std.flow.branch', { label: 'Can It Be Voided Here?' });
  g.input('report', 'report');
  g.input('claimId', 'claimId');
  g.add('rework', 'billing.rework-claim', { label: 'Work the Claim From the New Report' });
  g.add('void', 'billing.close-claim', {
    label: 'Void Revised Claim',
    values: { status: 'void' }
  });
  g.ret('done');
  g.wire('entry.exec', 'facts.exec');
  g.wire('entry.pcr', 'facts.pcr');
  g.wire('facts.then', 'note.exec');
  g.wire('facts.facts', 'classify.facts');
  g.wire('entry.report', 'note.report');
  g.wire('entry.claimId', 'note.claimId');
  g.wire('note.restartable', 'first.exec');
  g.wire('note.billed', 'first.exec');
  g.wire('note.previous', 'hasPrevious.value', 'readPrevious.report');
  g.wire('note.status', 'context.status');
  g.wire('hasPrevious.result', 'first.condition');
  g.wire('first.true', 'revision.exec');
  g.wire('first.false', 'readPrevious.exec');
  g.wire('readPrevious.then', 'keep.exec');
  g.wire('readPrevious.pcr', 'keep.value');
  g.wire('keep.then', 'revision.exec');
  g.wire('previous.value', 'context.previous');
  g.wire('pcr.pcr', 'trip.pcr', 'subject.pcr', 'context.pcr');
  g.wire('classify.tripType', 'trip.tripType');
  g.wire('classify.reason', 'trip.reason');
  g.wire('trip.trip', 'context.trip');
  g.wire('contextClaimId.claimId', 'context.claimId');
  g.wire('subject.subject', 'revision.subject');
  summarize(g, 'revision', REVISION_SUMMARY, { context: 'context.result' });
  g.wire('context.result', 'revision.context', 'canApply.object');
  g.wire('revision.apply', 'applies.exec');
  g.wire('canApply.value', 'applies.condition', 'voidable.condition');
  g.wire('applies.true', 'rework.exec');
  g.wire('applies.false', 'revision.exec');
  g.wire('report.report', 'rework.report');
  g.wire('claimId.claimId', 'rework.claimId', 'void.claimId');
  g.wire('rework.then', 'done.exec');
  g.wire('revision.acknowledge', 'done.exec');
  g.wire('revision.void', 'voidable.exec');
  g.wire('voidable.true', 'void.exec');
  g.wire('voidable.false', 'revision.exec');
  g.wire('void.then', 'done.exec');
  return g.def;
};

const encounterToClaim = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [p('report', BLOB), p('claimId', 'string', true)],
    outputs: [
      p('tripType', 'string', true),
      p('patient', PATIENT, true),
      p('claimId', 'string', true)
    ]
  });
  g.add('read', 'nemsis.read-report');
  g.add('pcr', 'nemsis.pcr.break');
  g.add('open', 'billing.open-claim', { label: 'Open Draft Claim' });
  g.add('work', 'billing.work-draft-claim', { label: 'Work the Draft Claim' });
  g.add('revision', 'billing.review-revision', { label: 'Review Updated PCR' });
  g.ret('done');
  g.ret('revised');
  g.wire('entry.exec', 'read.exec');
  g.wire('entry.report', 'read.report', 'open.report', 'work.report', 'revision.report');
  g.wire('entry.claimId', 'open.claimId');
  g.wire('read.then', 'open.exec');
  g.wire('read.pcr', 'pcr.pcr', 'work.pcr', 'revision.pcr');
  g.wire('pcr.pcrNumber', 'open.pcrNumber');
  g.wire('open.opened', 'work.exec');
  g.wire('open.duplicate', 'revision.exec');
  g.wire('open.claimId', 'work.claimId', 'revision.claimId', 'done.claimId', 'revised.claimId');
  for (const exit of ['claimed', 'skipped', 'voided']) g.wire(`work.${exit}`, 'done.exec');
  g.wire('work.tripType', 'done.tripType');
  g.wire('work.patient', 'done.patient');
  g.wire('revision.then', 'revised.exec');
  return g.def;
};

const recoverDraft = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [p('claimId', 'string'), p('report', BLOB, true), p('reason', 'string', true)],
    outputs: []
  });
  g.add('context', 'std.object.make', {
    label: 'Orphan Context',
    config: {
      fields: [
        { name: 'claimId', type: 'string' },
        { name: 'reason', type: 'string' }
      ]
    }
  });
  g.add('orphan', 'std.human.task', {
    label: 'Draft Claim Has No Workflow',
    config: {
      title: 'Draft claim has no workflow',
      queue: 'billing-review',
      instructions:
        'The workflow working this draft claim stopped before the claim was ready, so nothing would happen to it. Restart works it again from its report, or void it.',
      outcomes: ['restart', 'void']
    }
  });
  g.add('rework', 'billing.rework-claim', { label: 'Work the Claim Again' });
  g.add('void', 'billing.close-claim', {
    label: 'Void Orphaned Draft',
    values: { status: 'void' }
  });
  g.ret('done');
  g.wire('entry.exec', 'orphan.exec');
  g.wire('entry.claimId', 'context.claimId', 'rework.claimId', 'void.claimId');
  g.wire('entry.reason', 'context.reason');
  g.wire('entry.report', 'rework.report');
  g.wire('context.object', 'orphan.context');
  summarize(g, 'orphan', ORPHAN_SUMMARY, { reason: 'entry.reason' });
  g.wire('orphan.restart', 'rework.exec');
  g.wire('rework.then', 'done.exec');
  g.wire('orphan.void', 'void.exec');
  g.wire('void.then', 'done.exec');
  return g.def;
};

const PRIORITY_RANKS = [
  '2611003',
  '2611005',
  '2611007',
  '2611009',
  '2611011',
  '2611013',
  '2611015',
  '2611017',
  '2611019',
  '2611021',
  '2611023'
].map((key, value) => ({ key, value }));

const MSP_ANSWERS = [
  d(
    'mspEmployerPlan',
    'boolean',
    'Employer Plan',
    'The patient or spouse has a group health plan through current employment (working aged).',
    true
  ),
  d(
    'mspEsrd',
    'boolean',
    'End-Stage Renal Disease',
    'The patient has end-stage renal disease and is in the 30-month coordination period.',
    true
  ),
  d(
    'mspDisability',
    'boolean',
    'Disability',
    'The patient is under 65, disabled, with a large group health plan.',
    true
  ),
  d(
    'mspAccident',
    'string',
    'Accident',
    'An accident or work injury someone else pays for: none, liability, noFault or workersComp.',
    true
  )
];

const medicareSecondaryPayer = (): GraphDef => {
  const g = rule(MSP_ANSWERS, [
    d(
      'medicareSecondary',
      'boolean',
      'Medicare Secondary',
      'Whether another payer pays before Medicare.'
    ),
    d(
      'insuranceType',
      'string',
      'MSP Type',
      'The Medicare secondary payer type (SBR05): 12 working aged, 13 ESRD, 14 no-fault, 15 workers compensation, 43 disability, 47 liability.',
      true
    ),
    P.reasons('Medicare pays first or second')
  ]);
  g.add('decide', 'std.table.decide', {
    label: 'Medicare Secondary Payer',
    config: shared.decision(
      'billing.medicare-secondary-payer',
      'Medicare Secondary Payer',
      'Decides from the MSP answers whether another payer pays before Medicare, and the MSP type the 837P names for it.',
      table(
        [
          field('mspAccident', 'string', 'Accident or work injury'),
          field('mspEsrd', 'boolean', 'End-stage renal disease coordination period'),
          field('mspEmployerPlan', 'boolean', 'Group health plan from current employment'),
          field('mspDisability', 'boolean', 'Disabled with a large group health plan')
        ],
        [
          field('secondary', 'boolean', 'Medicare pays second'),
          field('insuranceType', 'string', 'MSP type (SBR05)')
        ],
        [
          {
            label: "Workers' compensation pays first",
            when: { mspAccident: is('workersComp') },
            set: { secondary: true, insuranceType: '15' }
          },
          {
            label: 'No-fault or auto insurance pays first',
            when: { mspAccident: is('noFault') },
            set: { secondary: true, insuranceType: '14' }
          },
          {
            label: 'Liability insurance pays first',
            when: { mspAccident: is('liability') },
            set: { secondary: true, insuranceType: '47' }
          },
          {
            label: 'End-stage renal disease coordination period',
            when: { mspEsrd: is(true) },
            set: { secondary: true, insuranceType: '13' }
          },
          {
            label: 'Working aged with an employer group health plan',
            when: { mspEmployerPlan: is(true) },
            set: { secondary: true, insuranceType: '12' }
          },
          {
            label: 'Disabled with a large group health plan',
            when: { mspDisability: is(true) },
            set: { secondary: true, insuranceType: '43' }
          }
        ],
        { secondary: false }
      )
    )
  });
  g.ret('return');
  for (const { name } of MSP_ANSWERS) g.wire(`entry.${name}`, `decide.${name}`);
  g.wire('decide.secondary', 'return.medicareSecondary');
  g.wire('decide.insuranceType', 'return.insuranceType');
  g.wire('decide.rules', 'return.reasons');
  return g.def;
};

const coordinationOrder = (): GraphDef => {
  const g = rule(
    [
      P.coverages('The payers as resolved.'),
      d(
        'medicareSecondary',
        'boolean',
        'Medicare Secondary',
        'Another payer pays before Medicare, as the Medicare Secondary Payer rule decided.',
        true
      )
    ],
    [
      P.coverages('The payers in the order they are billed.'),
      P.reasons('the payers are in this order')
    ]
  );
  g.add('priorities', 'std.list.pluck', {
    label: 'Reported Priorities',
    values: { field: 'priority' }
  });
  g.add('ranks', 'std.table.lookup', {
    label: 'Coverage Priority',
    config: shared.lookup(
      'billing.coverage-priority',
      'Coverage Priority',
      'The billing order of each reported coverage priority (ePayment.10): primary first, then secondary and on. Coverages with other priorities come last, in the order reported.',
      { type: 'integer', rows: PRIORITY_RANKS, fallback: PRIORITY_RANKS.length }
    )
  });
  g.add(
    'ordered',
    'std.expr',
    expr(
      'By Priority, Then as Reported',
      "map(sort(map(coverages, (c, n) => { c: c, rank: (medicareSecondary == true && contains(['MA', 'MB'], c.claimFiling) ? 1000000 : 0) + (ranks[n] ?? 99) * 1000 + n }), x => x.rank), x => x.c)"
    )
  );
  g.add(
    'reasons',
    'std.expr',
    expr(
      'Why',
      "concat(len(coverages) > 1 ? ['Billed in the priority order the report gives, then as reported'] : [], medicareSecondary == true && some(coverages, c => !contains(['MA', 'MB'], c.claimFiling)) ? ['Medicare is billed after the payers that pay first'] : [])"
    )
  );
  g.ret('return');
  g.wire('entry.coverages', 'priorities.list', 'ordered.coverages', 'reasons.coverages');
  g.wire('entry.medicareSecondary', 'ordered.medicareSecondary', 'reasons.medicareSecondary');
  g.wire('priorities.list', 'ranks.keys');
  g.wire('ranks.values', 'ordered.ranks');
  g.wire('ordered.result', 'return.coverages');
  g.wire('reasons.result', 'return.reasons');
  return g.def;
};

const determinePayers = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: ['then'],
    inputs: [
      d('coverages', COVERAGES, 'Reported Coverages', 'The coverages the report lists.'),
      p('pcr', PCR_TYPE, true),
      p('pcrNumber', 'string', true),
      p('patientName', 'string', true),
      p('facts', FACTS, true)
    ],
    outputs: [p('coverages', COVERAGES), p('notes', { list: 'string' })]
  });
  g.add('resolve', 'billing.resolve-payers', { label: 'Match Payer Directory' });
  g.add('facts', 'billing.encounter-facts.break');
  g.add('documentation', 'billing.documentation.break');
  g.add('msp', 'billing.medicare-secondary-payer', { label: 'Medicare Secondary Payer' });
  g.add('order', 'billing.coordination-order', { label: 'Coordination Order' });
  g.add('agency', 'billing.agency-payers', { label: 'Agency Payer Rules' });
  g.ret('done');
  g.wire('entry.exec', 'resolve.exec');
  g.wire('entry.coverages', 'resolve.coverages');
  g.wire('entry.pcrNumber', 'resolve.pcrNumber');
  g.wire('entry.patientName', 'resolve.patientName');
  g.wire('resolve.then', 'done.exec');
  g.wire('resolve.coverages', 'order.coverages');
  g.wire('entry.facts', 'facts.facts');
  g.wire('facts.documentation', 'documentation.documentation');
  for (const { name } of MSP_ANSWERS) g.wire(`documentation.${name}`, `msp.${name}`);
  g.wire('msp.medicareSecondary', 'order.medicareSecondary');
  g.wire('order.coverages', 'agency.coverages');
  g.wire('entry.pcr', 'agency.pcr');
  g.wire('agency.coverages', 'done.coverages');
  g.wire('resolve.notes', 'done.notes');
  return g.def;
};

const tripContext = (g: ReturnType<typeof graph>, id: string) =>
  g.add(id, 'std.expr', expr('Trip Context', '{ trip: trip }'));

const buildClaim = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: ['saved', 'voided'],
    inputs: [
      p('claimId', 'string'),
      p('report', BLOB, true),
      p('pcr', PCR_TYPE),
      p('facts', FACTS),
      p('tripType', 'string'),
      p('patient', PATIENT),
      p('coverages', COVERAGES),
      p('service', SERVICE),
      p('subject', 'string', true),
      p('context', 'any', true)
    ],
    outputs: []
  });
  g.add('primary', 'std.list.first', { label: 'Primary Payer' });
  g.add('primaryPayer', 'billing.coverage.break');
  g.add('charges', 'billing.assign-charges', { label: 'Assign Charges' });
  g.add('claim', 'billing.map-claim', { label: 'Assign Claim Properties' });
  g.add('agencyClaim', 'billing.agency-claim', { label: 'Agency Claim Rules' });
  g.add('save', 'billing.save-claim', { label: 'Save Draft Claim' });
  g.add('eligibilityInputs', 'std.object.make', {
    label: 'Eligibility Inputs',
    config: { fields: [{ name: 'claimId', type: 'string' }] }
  });
  g.add('eligibility', 'std.flow.start-workflow', {
    label: 'Check Eligibility of the Payers',
    config: { workflow: 'billing.check-eligibility', version: 1 }
  });
  g.ret('savedDone', 'saved');
  g.ret('voidedDone', 'voided');
  g.wire('entry.exec', 'charges.exec');
  g.wire('entry.tripType', 'charges.tripType', 'claim.tripType');
  g.wire('entry.service', 'charges.service', 'claim.service');
  g.wire('entry.coverages', 'primary.list', 'claim.coverages');
  g.wire('primary.item', 'primaryPayer.coverage');
  g.wire('primaryPayer.payerId', 'charges.payerId');
  g.wire('entry.subject', 'charges.subject');
  g.wire('entry.context', 'charges.context');
  g.wire('charges.voided', 'voidedDone.exec');
  g.wire('charges.priced', 'save.exec');
  g.wire('charges.lines', 'claim.lines');
  g.wire('charges.totalCents', 'claim.totalCents');
  g.wire('entry.facts', 'claim.facts');
  g.wire('entry.patient', 'claim.patient');
  g.wire('entry.report', 'claim.report');
  g.wire('claim.claim', 'agencyClaim.claim');
  g.wire('entry.pcr', 'agencyClaim.pcr');
  g.wire('agencyClaim.claim', 'save.claim');
  g.wire('entry.claimId', 'save.claimId', 'eligibilityInputs.claimId');
  g.wire('eligibilityInputs.object', 'eligibility.inputs');
  g.wire('save.then', 'eligibility.exec');
  g.wire('eligibility.then', 'savedDone.exec');
  return g.def;
};

const billClaim = (): GraphDef => {
  const g = graph(
    {
      execIn: ['exec'],
      execOut: ['claimed', 'voided'],
      inputs: [
        p('claimId', 'string'),
        p('report', BLOB, true),
        p('pcr', PCR_TYPE),
        p('facts', FACTS),
        p('tripType', 'string'),
        p('reason', 'string', true),
        p('patient', PATIENT),
        p('coverages', COVERAGES),
        p('payerNotes', { list: 'string' }),
        p('findings', FINDINGS)
      ],
      outputs: [p('tripType', 'string', true)]
    },
    [
      { name: 'tripType', type: 'string', default: null },
      { name: 'answers', type: { object: {} }, default: null }
    ]
  );
  g.add('classified', 'std.var.set', { label: 'Trip Type to Bill', config: { name: 'tripType' } });
  g.add('tripType', 'std.var.get', { label: 'Trip Type', config: { name: 'tripType' } });
  g.add('suggest', 'billing.determine-service', { label: 'Determine Service' });
  g.add('answers', 'std.var.get', { label: 'Answers Given Before', config: { name: 'answers' } });
  g.add('review', 'billing.review-pcr', { label: 'Review PCR' });
  g.add('remember', 'std.var.set', {
    label: 'Remember the Approved Answers',
    config: { name: 'answers' }
  });
  g.add('reviewed', 'std.var.set', { label: 'Reviewed Trip Type', config: { name: 'tripType' } });
  g.add('billedTrip', 'std.var.get', { label: 'Trip Type Billed', config: { name: 'tripType' } });
  g.add('trip', 'billing.trip-summary', { label: 'Trip Summary' });
  tripContext(g, 'claimContext');
  g.add('subject', 'billing.pcr-subject', { label: 'Task Subject' });
  g.add('build', 'billing.build-claim', { label: 'Build Claim' });
  g.add('responsibility', 'billing.decide-responsibility', { label: 'Decide Responsibility' });
  g.add('facility', 'billing.bill-facility', { label: 'Bill Facility' });
  g.add('fix', 'billing.fix-claim', { label: 'Check and Fix Claim', values: { all: false } });
  g.add('cycle', 'billing.start-cycle', { label: 'Start Payer Cycle' });
  g.add('finalTrip', 'std.var.get', { label: 'Final Trip Type', config: { name: 'tripType' } });
  g.add('void', 'billing.close-claim', { label: 'Void Draft Claim', values: { status: 'void' } });
  g.ret('claimed', 'claimed');
  g.ret('voided', 'voided');

  g.wire('entry.exec', 'classified.exec');
  g.wire('entry.tripType', 'classified.value');
  g.wire('classified.then', 'review.exec');
  g.wire('entry.facts', 'suggest.facts', 'review.facts', 'build.facts');
  g.wire('entry.findings', 'suggest.findings', 'review.findings');
  g.wire('entry.pcr', 'review.pcr', 'trip.pcr', 'subject.pcr', 'build.pcr');
  g.wire('tripType.value', 'suggest.tripType', 'review.tripType');
  g.wire('suggest.service', 'review.service');
  for (const pin of ['reason', 'patient', 'coverages', 'payerNotes']) {
    g.wire(`entry.${pin}`, `review.${pin}`);
  }
  g.wire('answers.value', 'review.answers');
  g.wire('review.approved', 'remember.exec');
  g.wire('review.answers', 'remember.value');
  g.wire('remember.then', 'reviewed.exec');
  g.wire('review.tripType', 'reviewed.value');
  g.wire('review.voided', 'void.exec');

  g.wire('reviewed.then', 'build.exec');
  g.wire('entry.reason', 'trip.reason');
  g.wire('billedTrip.value', 'trip.tripType', 'build.tripType');
  g.wire('trip.trip', 'claimContext.trip');
  for (const pin of ['claimId', 'report', 'patient', 'coverages']) {
    g.wire(`entry.${pin}`, `build.${pin}`);
  }
  g.wire('review.service', 'build.service');
  g.wire('subject.subject', 'build.subject', 'fix.subject', 'facility.subject');
  g.wire('claimContext.result', 'build.context', 'fix.context', 'facility.context');
  g.wire('entry.claimId', 'fix.claimId', 'cycle.claimId', 'void.claimId');
  g.wire('entry.claimId', 'responsibility.claimId', 'facility.claimId');
  g.wire('build.saved', 'responsibility.exec');
  g.wire('responsibility.payers', 'fix.exec');
  g.wire('responsibility.facility', 'facility.exec');
  g.wire('responsibility.facilityId', 'facility.facilityId');
  g.wire('responsibility.reason', 'facility.reason');
  g.wire('facility.billed', 'cycle.exec');
  g.wire('facility.payers', 'fix.exec');
  g.wire('facility.voided', 'void.exec');
  g.wire('build.voided', 'void.exec');
  g.wire('fix.fixed', 'cycle.exec');
  g.wire('fix.backToReview', 'review.exec');
  g.wire('fix.voided', 'void.exec');
  g.wire('cycle.then', 'claimed.exec');
  g.wire('finalTrip.value', 'claimed.tripType');
  g.wire('void.then', 'voided.exec');
  return g.def;
};

const workDraftClaim = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: ['claimed', 'skipped', 'voided'],
    inputs: [p('report', BLOB, true), p('pcr', PCR_TYPE), p('claimId', 'string')],
    outputs: [p('tripType', 'string', true), p('patient', PATIENT, true)]
  });
  g.add('facts', 'billing.map-encounter-facts', { label: 'Map Encounter Facts' });
  g.add('parts', 'billing.encounter-facts.break', { label: 'Encounter Facts' });
  g.add('trip', 'billing.trip-facts.break', { label: 'Trip Facts' });
  g.add('clinical', 'billing.clinical-facts.break', { label: 'Clinical Facts' });
  g.add('decide', 'billing.decide-claim', { label: 'Is a Claim Needed?' });
  g.add('skip', 'billing.close-claim', {
    label: 'Void Skipped Claim',
    values: { status: 'void' }
  });
  g.add('findings', 'billing.read-findings', { label: 'Narrative Findings' });
  g.add('patient', 'billing.claim-patient', { label: 'Claim Patient' });
  g.add('patientName', 'std.text.template', {
    label: 'Patient Name',
    config: { template: '{{ demographics.firstName }} {{ demographics.lastName }}' }
  });
  g.add('payers', 'billing.determine-payers', { label: 'Determine Payers' });
  g.add('bill', 'billing.bill-claim', { label: 'Bill the Claim' });
  g.ret('skipped', 'skipped');
  g.ret('claimed', 'claimed');
  g.ret('voided', 'voided');

  g.wire('entry.exec', 'facts.exec');
  g.wire('entry.pcr', 'facts.pcr', 'decide.pcr', 'payers.pcr', 'bill.pcr');
  g.wire('facts.then', 'decide.exec');
  g.wire('facts.facts', 'parts.facts', 'decide.facts', 'bill.facts');
  g.wire('parts.trip', 'trip.trip');
  g.wire('parts.clinical', 'clinical.clinical');
  g.wire('decide.skip', 'skip.exec');
  g.wire('entry.claimId', 'skip.claimId', 'patient.claimId', 'bill.claimId');
  g.wire('skip.then', 'skipped.exec');
  g.wire('decide.tripType', 'skipped.tripType', 'bill.tripType');
  g.wire('decide.reason', 'bill.reason');
  g.wire('decide.claim', 'findings.exec');
  g.wire('clinical.narrative', 'findings.narrative');
  g.wire('findings.then', 'patient.exec');
  g.wire('parts.patient', 'patient.demographics', 'patientName.demographics');
  g.wire('trip.pcrNumber', 'patient.pcrNumber', 'payers.pcrNumber');
  g.wire('patient.then', 'payers.exec');
  g.wire('parts.coverages', 'payers.coverages');
  g.wire('facts.facts', 'payers.facts');
  g.wire('patientName.text', 'payers.patientName');
  g.wire('payers.then', 'bill.exec');
  g.wire('entry.report', 'bill.report');
  g.wire('patient.patient', 'bill.patient', 'claimed.patient', 'voided.patient');
  g.wire('payers.coverages', 'bill.coverages');
  g.wire('payers.notes', 'bill.payerNotes');
  g.wire('findings.findings', 'bill.findings');
  g.wire('bill.claimed', 'claimed.exec');
  g.wire('bill.tripType', 'claimed.tripType');
  g.wire('bill.voided', 'voided.exec');
  return g.def;
};

export const intakeGraphs: SeedGraph[] = [
  slot(
    'billing.agency-payers',
    'Agency Payer Rules',
    'An agency rule after payers are resolved and ordered: reorder, add or drop coverages before the claim is billed. Passes the coverages through unchanged until an agency overrides it.',
    {
      execIn: [],
      execOut: [],
      inputs: [
        d(
          'coverages',
          COVERAGES,
          'Coverages',
          'The payers resolved from the report, in billing order.'
        ),
        P.pcr(true)
      ],
      outputs: [d('coverages', COVERAGES, 'Coverages', 'The payers to bill, in order.')]
    }
  ),
  asStage(
    'billing.review-patient-match',
    'Review Patient Match',
    'Asks a biller to pick the patient among likely matches for report demographics, or to create a new patient from the report.',
    reviewPatientMatch()
  ),
  asStage(
    'billing.resolve-patient',
    'Resolve Patient',
    'Matches report demographics to a patient, creates one when nothing is close, asks a biller to pick among likely matches or create a new one, and asks for a missing or invalid name or birth date (prefilled with what was entered before), then matches the completed details the same way.',
    resolvePatient()
  ),
  asStage(
    'billing.resolve-payers',
    'Match Payer Directory',
    'Links report payers to the payer directory and asks a biller about every other name: link it (remembered for later reports), leave it unlisted, or remove it when it is not insurance. Outputs what limited the matching.',
    resolvePayers()
  ),
  asRule(
    'billing.medicare-secondary-payer',
    'Medicare Secondary Payer',
    'Decides from the MSP answers (employer plan, ESRD, disability, accident or work injury) whether another payer pays before Medicare, with the MSP type the 837P names (Medicare Secondary Payer table).',
    medicareSecondaryPayer()
  ),
  asRule(
    'billing.coordination-order',
    'Coordination Order',
    'Puts the payers in billing order: by the priority the report gives each coverage (Coverage Priority table), then as reported, with Medicare after the other payers when the Medicare Secondary Payer rule says another payer pays first.',
    coordinationOrder()
  ),
  asStage(
    'billing.determine-payers',
    'Determine Payers',
    'Determines the payers to bill from the reported coverages: Match Payer Directory, Medicare Secondary Payer from the MSP answers the report gives, Coordination Order, then the Agency Payer Rules.',
    determinePayers()
  ),
  asRule(
    'billing.pcr-subject',
    'PCR Subject',
    'Names a report in task lists: its PCR number and the patient name.',
    pcrSubject()
  ),
  asRule(
    'billing.trip-summary',
    'Trip Summary',
    'Describes a trip for billers: PCR number, trip type and why, call time, response, care, impressions, pickup and destination.',
    tripSummary()
  ),
  asStage(
    'billing.read-findings',
    'Read Narrative Findings',
    'Reads the medications and procedures the narrative documents with the local model, retrying while it is busy, or leaves the findings unread when it is down.',
    readFindings()
  ),
  asStage(
    'billing.claim-patient',
    'Claim Patient',
    'Resolves the patient from the report demographics, keeps their current address and assigns them to the draft claim.',
    claimPatient()
  ),
  asStage(
    'billing.review-pcr',
    'Review PCR',
    'Coding review: asks a biller to confirm the trip type, level of service and loaded miles, prefilled with earlier answers or the suggestion and showing every reason. Held reports wait for release or void.',
    reviewPcr()
  ),
  asStage(
    'billing.build-claim',
    'Build Claim',
    'Assigns the charges for the confirmed service, priced for the primary payer, assigns the claim properties from the encounter facts, applies the Agency Claim Rules and saves the draft, then checks the payers eligibility; or voids.',
    buildClaim()
  ),
  asStage(
    'billing.start-cycle',
    'Start Payer Cycle',
    'Starts the Cycle Claim workflow for a claim and links the claim to it.',
    startCycle()
  ),
  asStage(
    'billing.rework-claim',
    'Work the Claim Again',
    'Starts Encounter to Claim again for a claim from its report.',
    reworkClaim()
  ),
  asStage(
    'billing.review-revision',
    'Review Updated PCR',
    'Shows a biller what a newer report changed on an existing claim, and works the claim again from it, keeps the claim as it is, or voids it.',
    reviewRevision()
  ),
  asStage(
    'billing.bill-claim',
    'Bill the Claim',
    'Determines the service for the trip type, has a biller review it, builds the claim, has a biller bill a facility instead when the Facility Responsibility rule says so (Bill Facility, then the payer cycle waits on the facility invoice), else checks the claim, and starts its payer cycle. A claim sent back to review is reviewed again with the answers given before.',
    billClaim()
  ),
  asStage(
    'billing.work-draft-claim',
    'Work Draft Claim',
    'Works a draft claim from its report: maps the encounter facts, decides whether to claim, reads the narrative, resolves the patient, determines the payers, then bills the claim.',
    workDraftClaim()
  ),
  asWorkflow(
    'billing.encounter-to-claim',
    'Encounter to Claim',
    'Turns one patient care report into a claim: opens a draft claim (or works an existing one again), maps the encounter facts, classifies the trip, reads the narrative when the model is up, resolves the patient and payers, determines the service, has a biller confirm it, assigns and prices the charges and claim properties, saves the draft, checks and fixes it and starts its payer cycle. Reports already billed become revisions of their claim, shown with what changed.',
    encounterToClaim()
  ),
  asWorkflow(
    'billing.recover-draft',
    'Recover Draft Claim',
    'Asks a biller what to do with a draft claim whose workflow stopped: work it again from its report, or void it.',
    recoverDraft()
  )
];
