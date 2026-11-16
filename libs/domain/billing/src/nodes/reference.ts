import { actionNode, branchNode, pin } from '@ugula/graph';
import { readLines } from '../charges.ts';
import { CODE_SET_NAMES, CODE_SETS, isCodeSet, normalizeCode } from '../code-sets.ts';
import { usState, zipCode } from '../geo.ts';
import { feeYearOf, isRurality, medicareAllowed } from '../medicare-fees.ts';
import { isCents, requiredText, textOrNull } from '../values.ts';
import type { NodesOf } from './stores.ts';

const CATEGORY = 'Billing';

const CHARGED_LINES = {
  list: { object: { code: { code: 'hcpcs' }, units: 'number', chargeCents: 'integer' } }
} as const;

const ALLOWED_LINES = {
  list: { object: { code: { code: 'hcpcs' }, units: 'number', allowedCents: 'integer' } }
} as const;

const foundExits = (notFound: string) => ({
  found: { label: 'Found', description: 'A match was found.' },
  notFound: { label: 'Not Found', description: notFound }
});

const notFound = { exit: 'notFound' as const, outputs: {} };

const postalCodePin = pin('postalCode', 'string', {
  label: 'ZIP Code',
  description: 'The ZIP code to look up, with or without the +4.'
});

export const referenceNodes: NodesOf = (stores) => {
  const reference = () => stores().reference;
  return [
    branchNode({
      type: 'billing.find-code',
      title: 'Find Code',
      category: CATEGORY,
      description: `Looks a code up in one of the code sets (${CODE_SETS.map((s) => `${s}: ${CODE_SET_NAMES[s]}`).join(', ')}) and gives its description and whether it is billable; only ICD-10-CM has codes that are not, the categories that need more characters. ICD-10 codes are found with or without the dot.`,
      level: 'basic',
      keywords: ['lookup', 'icd-10', 'hcpcs', 'diagnosis', 'code description'],
      inputs: [
        pin('codeSet', 'string', { label: 'Code Set', description: 'The code set to look in.' }),
        pin('code', 'string', { description: 'The code to look up.' })
      ],
      outputs: [
        pin('description', 'string', { description: 'What the code means.' }),
        pin('billable', 'boolean', { description: 'Whether the code can be billed.' })
      ],
      exits: foundExits('The code set does not have the code.'),
      compute: async (inputs) => {
        if (!isCodeSet(inputs.codeSet)) throw new Error(`${inputs.codeSet} is not a code set`);
        const code = normalizeCode(inputs.codeSet, requiredText(inputs.code, 'No code to find'));
        const found = await reference().findCode(inputs.codeSet, code);
        return found ? { exit: 'found', outputs: found } : notFound;
      }
    }),
    branchNode({
      type: 'billing.find-medicare-locality',
      title: 'Find Medicare Locality',
      category: CATEGORY,
      description:
        "Finds the Medicare carrier, locality and rurality (urban, rural or superRural) of a ZIP code from the CMS ZIP files, using the ZIP+4 where CMS splits a ZIP between localities. Medicare prices a trip by its pickup ZIP; plusFourNeeded means the ZIP is split but no ZIP+4 was given, so the ZIP's default locality was used.",
      level: 'basic',
      keywords: ['medicare', 'locality', 'rural', 'zip'],
      inputs: [postalCodePin],
      outputs: [
        pin('carrier', 'string', { description: 'The Medicare carrier (MAC) of the ZIP.' }),
        pin('locality', 'string', { description: 'The Medicare locality of the ZIP.' }),
        pin('rurality', 'string', {
          description: 'Whether the ZIP is urban, rural or super rural.'
        }),
        pin('plusFourNeeded', 'boolean', {
          label: 'ZIP+4 Needed',
          description: "The ZIP is split between localities, so the ZIP's default was used."
        })
      ],
      exits: foundExits('CMS does not list the ZIP.'),
      compute: async (inputs) => {
        const zip = zipCode(inputs.postalCode);
        const found = zip ? await reference().medicareLocality(zip) : null;
        return found ? { exit: 'found', outputs: found } : notFound;
      }
    }),
    actionNode({
      type: 'billing.medicare-allowed',
      title: 'Medicare Allowed',
      category: CATEGORY,
      description:
        'Works out what Medicare allows for each line from the CMS ambulance fee schedule of the year of the date of service, for the carrier, locality and rurality: the urban, rural or super-rural base rate, and for rural ground mileage the first 17 miles at the short trip rate, but never more than the line was charged (42 CFR 414.610). Lists the codes the schedule has no fee for, such as A0888, or every code when it has no schedule for that year. Compare it with what a payer allowed to find underpayments.',
      level: 'basic',
      keywords: ['medicare', 'fee schedule', 'underpayment', 'allowed'],
      inputs: [
        pin('lines', CHARGED_LINES, {
          label: 'Charge Lines',
          description: 'The HCPCS codes, units and charges of the claim.'
        }),
        pin('serviceDate', 'string', {
          label: 'Date of Service',
          description: 'The date of service (YYYY-MM-DD), which picks the fee year.'
        }),
        pin('carrier', 'string', { description: 'The Medicare carrier (MAC) of the pickup.' }),
        pin('locality', 'string', { description: 'The Medicare locality of the pickup.' }),
        pin('rurality', 'string', {
          description: 'Whether the pickup is urban, rural or super rural.'
        })
      ],
      outputs: [
        pin('lines', ALLOWED_LINES, {
          label: 'Allowed Lines',
          description: 'Each line with what Medicare allows for it.'
        }),
        pin('totalCents', 'integer', {
          label: 'Total Allowed (Cents)',
          description: 'What Medicare allows for the claim, in cents.'
        }),
        pin(
          'missing',
          { list: { code: 'hcpcs' } },
          {
            label: 'Codes Without a Fee',
            description: 'The codes the fee schedule has no fee for.'
          }
        )
      ],
      compute: async (inputs) => {
        const lines = readLines(inputs.lines).map((l, i) => {
          const charge = inputs.lines[i]?.chargeCents;
          return { ...l, chargeCents: isCents(charge) ? charge : null };
        });
        if (!isRurality(inputs.rurality)) {
          throw new Error(`${inputs.rurality} is not urban, rural or superRural`);
        }
        const year = feeYearOf(textOrNull(inputs.serviceDate));
        if (year === null) throw new Error(`${inputs.serviceDate} is not a date of service`);
        const fees = await reference().medicareFees(
          year,
          requiredText(inputs.carrier, 'No Medicare carrier'),
          requiredText(inputs.locality, 'No Medicare locality'),
          [...new Set(lines.map((l) => l.code))]
        );
        return medicareAllowed(lines, fees, inputs.rurality);
      }
    }),
    branchNode({
      type: 'billing.find-zip-place',
      title: 'Find ZIP Place',
      category: CATEGORY,
      description:
        'Finds the city, state, county and coordinates of a ZIP code from GeoNames (CC BY 4.0), to check or fill in an address.',
      level: 'basic',
      keywords: ['zip', 'city', 'county', 'address'],
      inputs: [postalCodePin],
      outputs: [
        pin('city', 'string', { description: 'The city of the ZIP.' }),
        pin('state', 'string', { description: 'The state of the ZIP.' }),
        pin('county', 'string', { description: 'The county of the ZIP.' }),
        pin('countyFips', 'string', {
          label: 'County FIPS Code',
          description: 'The FIPS code of the county.'
        }),
        pin('latitude', 'number', { description: 'The latitude of the ZIP.' }),
        pin('longitude', 'number', { description: 'The longitude of the ZIP.' })
      ],
      exits: foundExits('The ZIP is not known.'),
      compute: async (inputs) => {
        const zip = zipCode(inputs.postalCode);
        const found = zip ? await reference().zipPlace(zip.slice(0, 5)) : null;
        if (!found) return notFound;
        const { postalCode: _, ...place } = found;
        return { exit: 'found', outputs: place };
      }
    }),
    branchNode({
      type: 'billing.find-hospital',
      title: 'Find Hospital',
      category: CATEGORY,
      description:
        "Finds the CMS-certified hospital a name refers to in a state, such as a trip's destination, with its CMS Certification Number (CCN), address, type and whether it has emergency services. The name must stand out from the other hospitals in the state, or the ZIP code must single one out among close names.",
      level: 'basic',
      keywords: ['hospital', 'ccn', 'destination', 'facility'],
      inputs: [
        pin('name', 'string', { optional: true, description: 'The hospital name as written.' }),
        pin('state', 'string', { optional: true, description: 'The state the hospital is in.' }),
        pin('postalCode', 'string', {
          label: 'ZIP Code',
          optional: true,
          description: 'The ZIP code, to tell close names apart.'
        })
      ],
      outputs: [
        pin('ccn', 'string', { label: 'CCN', description: 'The CMS Certification Number.' }),
        pin('name', 'string', { description: 'The hospital name as CMS lists it.' }),
        pin('addressLine', 'string', {
          label: 'Street Address',
          description: 'The street address of the hospital.'
        }),
        pin('city', 'string', { description: 'The city of the hospital.' }),
        pin('state', 'string', { description: 'The state of the hospital.' }),
        pin('postalCode', 'string', {
          label: 'ZIP Code',
          description: 'The ZIP code of the hospital.'
        }),
        pin('phone', 'string', { description: 'The phone number of the hospital.' }),
        pin('hospitalType', 'string', {
          label: 'Hospital Type',
          description: 'The kind of hospital, as CMS lists it.'
        }),
        pin('emergencyServices', 'boolean', {
          label: 'Emergency Services',
          description: 'Whether the hospital has emergency services.'
        }),
        pin('similarity', 'number', {
          description: 'How close the name is to the one given, from 0 to 1.'
        })
      ],
      exits: foundExits('No hospital matches, or there is no name or US state.'),
      compute: async (inputs) => {
        const name = textOrNull(inputs.name);
        const state = usState(inputs.state);
        const zip = zipCode(textOrNull(inputs.postalCode));
        const found =
          name && state
            ? await reference().findHospital(name, state, zip?.slice(0, 5) ?? null)
            : null;
        return found ? { exit: 'found', outputs: found } : notFound;
      }
    })
  ];
};
