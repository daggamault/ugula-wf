import { isRecord, type Json } from '@ugula/graph';
import { codeSystemOf, describeCode, type ReportDictionary, toPcr } from '@ugula/nemsis';

type Fact = { label: string; value: string | null; isDay?: boolean };

type Insurance = {
  payer: string | null;
  priority: string | null;
  memberId: string | null;
  groupId: string | null;
  relationship: string | null;
};

type Vital = {
  takenAt: string | null;
  bloodPressure: string | null;
  heartRate: number | null;
  pulseOximetry: number | null;
  respiratoryRate: number | null;
  bloodGlucose: number | null;
  glasgowComaScore: number | null;
};

type Medication = {
  givenAt: string | null;
  medication: string | null;
  route: string | null;
  dose: string | null;
};

type Procedure = { performedAt: string | null; procedure: string | null };

export type PcrSummary = {
  patient: Fact[];
  paymentMethod: string | null;
  insurances: Insurance[];
  times: { label: string; at: string | null }[];
  scene: Fact[];
  destination: Fact[];
  response: Fact[];
  situation: Fact[];
  vitals: Vital[];
  medications: Medication[];
  procedures: Procedure[];
  narrative: string | null;
  odometer: Fact[];
  loadedMiles: number | null;
};

const sectionOf = (x: Json | undefined): Record<string, Json> => (isRecord(x) ? x : {});

const recordsOf = (x: Json | undefined) => (Array.isArray(x) ? x.filter(isRecord) : []);

const textOf = (x: Json | undefined) => (typeof x === 'string' ? x : null);

const textsOf = (x: Json | undefined) =>
  Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : [];

const numberOf = (x: Json | undefined) => (typeof x === 'number' ? x : null);

const joined = (parts: readonly (string | null)[], by = ', ') =>
  parts.filter(Boolean).join(by) || null;

const DEPRECATED = /\s*\(deprecated\)$/i;

const SYSTEM_NAMES: Readonly<Record<string, string>> = {
  icd10: 'ICD-10',
  rxnorm: 'RxNorm',
  snomed: 'SNOMED CT'
};

const createDecoder = (dictionary: ReportDictionary) => {
  const meaningOf = (list: string, value: string) =>
    describeCode(dictionary, list, value)?.replace(DEPRECATED, '') ?? null;
  const name = (list: string, code: Json | undefined) => {
    const value = textOf(code);
    return value === null ? null : (meaningOf(list, value) ?? value);
  };
  const decode = (list: string, code: Json | undefined) => {
    const value = textOf(code);
    if (value === null) return null;
    const meaning = meaningOf(list, value);
    const system = SYSTEM_NAMES[codeSystemOf(list) ?? ''];
    if (meaning === null) return system ? `${system} ${value}` : value;
    return `${meaning} (${value})`;
  };
  const decodeAll = (list: string, codes: Json | undefined) =>
    joined(
      textsOf(codes).map((c) => decode(list, c)),
      '; '
    );
  return { name, decode, decodeAll };
};

const fact = (label: string, value: string | null): Fact => ({ label, value });

const roundMiles = (miles: number) => Math.round(miles * 100) / 100;

export const readPcr = (data: Json, dictionary: ReportDictionary): PcrSummary => {
  const { name, decode, decodeAll } = createDecoder(dictionary);
  const pcr = toPcr(data);
  const response = sectionOf(pcr.response);
  const times = sectionOf(pcr.times);
  const patient = sectionOf(pcr.patient);
  const payment = sectionOf(pcr.payment);
  const scene = sectionOf(pcr.scene);
  const situation = sectionOf(pcr.situation);
  const disposition = sectionOf(pcr.disposition);
  const place = (s: Record<string, Json>, lists: { city: string; state: string }) =>
    joined([
      textOf(s.addressLine),
      decode(lists.city, s.city),
      joined([name(lists.state, s.state), textOf(s.postalCode)], ' ')
    ]);
  const sceneOdometer = numberOf(response.sceneOdometer);
  const destinationOdometer = numberOf(response.destinationOdometer);
  const odometerText = (miles: number | null) => (miles === null ? null : String(miles));
  const incidentDisposition = decode('eDisposition.12', disposition.incidentDisposition);
  return {
    patient: [
      fact(
        'Name',
        joined(
          [textOf(patient.firstName), textOf(patient.middleName), textOf(patient.lastName)],
          ' '
        )
      ),
      { label: 'Date of Birth', value: textOf(patient.birthDate), isDay: true },
      fact('Sex', decode('ePatient.25', patient.sex) ?? decode('ePatient.13', patient.gender)),
      fact('Address', place(patient, { city: 'ePatient.06', state: 'ePatient.08' })),
      fact('Phone', textOf(patient.phone))
    ],
    paymentMethod: decode('ePayment.01', payment.method),
    insurances: recordsOf(pcr.insurances).map((i) => ({
      payer: textOf(i.companyName) ?? textOf(i.companyId),
      priority: decode('ePayment.11', i.priority),
      memberId: textOf(i.policyId),
      groupId: textOf(i.groupId),
      relationship: decode('ePayment.22', i.relationship)
    })),
    times: [
      { label: 'Call Received', at: textOf(times.psapCall) },
      { label: 'En Route', at: textOf(times.enRoute) },
      { label: 'At Scene', at: textOf(times.arrivedOnScene) },
      { label: 'At Patient', at: textOf(times.arrivedAtPatient) },
      { label: 'Left Scene', at: textOf(times.leftScene) },
      { label: 'At Destination', at: textOf(times.arrivedAtDestination) },
      { label: 'In Service', at: textOf(times.backInService) }
    ],
    scene: [
      fact('Name', textOf(scene.facilityName)),
      fact('Address', place(scene, { city: 'eScene.17', state: 'eScene.18' })),
      fact('Location Type', decode('eScene.09', scene.locationType))
    ],
    destination: [
      fact('Name', textOf(disposition.destinationName)),
      fact('Address', place(disposition, { city: 'eDisposition.04', state: 'eDisposition.05' })),
      fact('Destination Type', decode('eDisposition.21', disposition.destinationType)),
      fact('Reason for Choosing', decodeAll('eDisposition.20', disposition.destinationReasons))
    ],
    response: [
      fact('Type of Service', decode('eResponse.05', response.serviceType)),
      fact('Response Mode', decode('eResponse.23', response.responseMode)),
      fact('Level of Care', decode('eDisposition.32', disposition.levelOfCare)),
      ...(incidentDisposition === null
        ? [
            fact('Unit Disposition', decode('eDisposition.27', disposition.unitDisposition)),
            fact(
              'Patient Evaluation and Care',
              decode('eDisposition.28', disposition.patientEvaluation)
            ),
            fact(
              'Transport Disposition',
              decode('eDisposition.30', disposition.transportDisposition)
            )
          ]
        : [fact('Incident Disposition', incidentDisposition)]),
      fact('CMS Service Level', decode('ePayment.50', payment.cmsServiceLevel))
    ],
    situation: [
      fact('Complaint', textOf(situation.complaint)),
      fact('Primary Impression', decode('eSituation.11', situation.primaryImpression)),
      fact('Secondary Impressions', decodeAll('eSituation.12', situation.secondaryImpressions)),
      fact('Primary Symptom', decode('eSituation.09', situation.primarySymptom)),
      fact('Other Symptoms', decodeAll('eSituation.10', situation.otherSymptoms))
    ],
    vitals: recordsOf(pcr.vitals).map((v) => {
      const systolic = numberOf(v.systolic);
      const diastolic = numberOf(v.diastolic);
      return {
        takenAt: textOf(v.takenAt),
        bloodPressure: systolic === null ? null : `${systolic}/${diastolic ?? '—'}`,
        heartRate: numberOf(v.heartRate),
        pulseOximetry: numberOf(v.pulseOximetry),
        respiratoryRate: numberOf(v.respiratoryRate),
        bloodGlucose: numberOf(v.bloodGlucose),
        glasgowComaScore: numberOf(v.glasgowComaScore)
      };
    }),
    medications: recordsOf(pcr.medications).map((m) => {
      const dosage = numberOf(m.dosage);
      return {
        givenAt: textOf(m.administeredAt),
        medication: decode('eMedications.03', m.medication),
        route: decode('eMedications.04', m.route),
        dose:
          dosage === null
            ? null
            : joined([String(dosage), name('eMedications.06', m.dosageUnits)], ' ')
      };
    }),
    procedures: recordsOf(pcr.procedures).map((p) => ({
      performedAt: textOf(p.performedAt),
      procedure: decode('eProcedures.03', p.procedure)
    })),
    narrative: textOf(pcr.narrative),
    odometer: [
      fact('At Scene', odometerText(sceneOdometer)),
      fact('At Destination', odometerText(destinationOdometer))
    ],
    loadedMiles:
      sceneOdometer === null || destinationOdometer === null
        ? null
        : roundMiles(destinationOdometer - sceneOdometer)
  };
};
