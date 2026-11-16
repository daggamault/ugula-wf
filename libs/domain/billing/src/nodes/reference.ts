import { actionNode, branchNode, pin } from '@ugula/graph';
import { readLines } from '../charges.ts';
import { CODE_SET_NAMES, CODE_SETS, isCodeSet, normalizeCode } from '../code-sets.ts';
import { usState, zipCode } from '../geo.ts';
import { isRurality, medicareAllowed } from '../medicare-fees.ts';
import { requiredText, textOrNull } from '../values.ts';
import type { NodesOf } from './stores.ts';

const CATEGORY = 'Billing';

const CHARGE_LINES = { list: { object: { code: 'string', units: 'number' } } } as const;

const ALLOWED_LINES = {
  list: { object: { code: 'string', units: 'number', allowedCents: 'integer' } }
} as const;

const FOUND = ['found', 'notFound'] as const;

const notFound = { exit: 'notFound' as const, outputs: {} };

const postalCodePin = pin('postalCode', 'string', { label: 'ZIP Code' });

export const referenceNodes: NodesOf = (stores) => {
  const reference = () => stores().reference;
  return [
    branchNode({
      type: 'billing.find-code',
      title: 'Find Code',
      category: CATEGORY,
      description: `Looks a code up in one of the code sets (${CODE_SETS.map((s) => `${s}: ${CODE_SET_NAMES[s]}`).join(', ')}) and gives its description and whether it is billable; only ICD-10-CM has codes that are not, the categories that need more characters. ICD-10 codes are found with or without the dot. Continues through notFound for a code the set does not have.`,
      inputs: [pin('codeSet', 'string'), pin('code', 'string')],
      outputs: [pin('description', 'string'), pin('billable', 'boolean')],
      exits: FOUND,
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
        "Finds the Medicare carrier, locality and rurality (urban, rural or superRural) of a ZIP code from the CMS ZIP files, using the ZIP+4 where CMS splits a ZIP between localities. Medicare prices a trip by its pickup ZIP; plusFourNeeded means the ZIP is split but no ZIP+4 was given, so the ZIP's default locality was used. Continues through notFound for a ZIP CMS doesn't list.",
      inputs: [postalCodePin],
      outputs: [
        pin('carrier', 'string'),
        pin('locality', 'string'),
        pin('rurality', 'string'),
        pin('plusFourNeeded', 'boolean', { label: 'ZIP+4 Needed' })
      ],
      exits: FOUND,
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
        'Works out what Medicare allows for each line from the CMS ambulance fee schedule for the carrier, locality and rurality: the urban, rural or super-rural base rate, and for rural mileage the first 17 miles at the short trip rate. Lists the codes Medicare has no fee for, such as A0888. Compare it with what a payer paid to find underpayments.',
      inputs: [
        pin('lines', CHARGE_LINES),
        pin('carrier', 'string'),
        pin('locality', 'string'),
        pin('rurality', 'string')
      ],
      outputs: [
        pin('lines', ALLOWED_LINES),
        pin('totalCents', 'integer', { label: 'Total Allowed (Cents)' }),
        pin('missing', { list: 'string' })
      ],
      compute: async (inputs) => {
        const lines = readLines(inputs.lines);
        if (!isRurality(inputs.rurality)) {
          throw new Error(`${inputs.rurality} is not urban, rural or superRural`);
        }
        const fees = await reference().medicareFees(
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
        'Finds the city, state, county and coordinates of a ZIP code from GeoNames (CC BY 4.0), to check or fill in an address. Continues through notFound for a ZIP it does not know.',
      inputs: [postalCodePin],
      outputs: [
        pin('city', 'string'),
        pin('state', 'string'),
        pin('county', 'string'),
        pin('countyFips', 'string', { label: 'County FIPS Code' }),
        pin('latitude', 'number'),
        pin('longitude', 'number')
      ],
      exits: FOUND,
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
        "Finds the CMS-certified hospital a name refers to in a state, such as a trip's destination, with its CMS Certification Number (CCN), address, type and whether it has emergency services. The name must stand out from the other hospitals in the state, or the ZIP code must single one out among close names. Continues through notFound when no hospital matches, or without a name or a US state.",
      inputs: [
        pin('name', 'string', { optional: true }),
        pin('state', 'string', { optional: true }),
        pin('postalCode', 'string', { label: 'ZIP Code', optional: true })
      ],
      outputs: [
        pin('ccn', 'string', { label: 'CCN' }),
        pin('name', 'string'),
        pin('addressLine', 'string'),
        pin('city', 'string'),
        pin('state', 'string'),
        pin('postalCode', 'string', { label: 'ZIP Code' }),
        pin('phone', 'string'),
        pin('hospitalType', 'string'),
        pin('emergencyServices', 'boolean'),
        pin('similarity', 'number')
      ],
      exits: FOUND,
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
