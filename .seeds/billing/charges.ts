import { NO_TRANSPORT_CODE } from '@ugula/billing';
import type { GraphDef } from '@ugula/graph';
import { slot } from '../builder.ts';
import { hcpcsDescriptions } from '../codes.ts';
import type { SeedGraph } from '../graphs.ts';
import {
  asRule,
  asStage,
  CHARGE_LINES,
  d,
  exit,
  FEES,
  field,
  is,
  oneOf,
  P,
  rule,
  shared,
  stage,
  T,
  table,
  template
} from './shared.ts';

const NO_TRANSPORT = ['treatNoTransport', 'refusal'];

const LINES_OUT = d('lines', CHARGE_LINES, 'Charge Lines', 'HCPCS codes and units to price.');

const CODE_OUT = d('code', { code: 'hcpcs' }, 'HCPCS Code', 'The HCPCS code to bill.');

const baseRateCode = (): GraphDef => {
  const g = rule(
    [P.classification(), P.service()],
    [CODE_OUT, P.reasons('this base rate was billed')]
  );
  g.add('service', 'billing.service.break');
  g.add('base', 'std.table.decide', {
    label: 'Base Rate',
    config: shared.decision(
      'billing.base-rate',
      'Base Rate',
      'Picks the HCPCS base rate code from the classification, level of service and emergency status; a patient pronounced dead before loading is billed at the BLS rate.',
      table(
        [
          field('classification', 'string', 'Classification'),
          field('level', 'string', 'Level of service'),
          field('emergency', 'boolean', 'Emergency'),
          field('deceased', 'boolean', 'Pronounced dead before loading')
        ],
        [field('code', { code: 'hcpcs' }, 'HCPCS code')],
        [
          {
            label: 'Pronounced dead before loading, emergency response',
            when: { deceased: is(true), emergency: is(true) },
            set: { code: 'A0429' }
          },
          {
            label: 'Pronounced dead before loading',
            when: { deceased: is(true) },
            set: { code: 'A0428' }
          },
          {
            label: 'Treated without transport',
            when: { classification: oneOf(...NO_TRANSPORT) },
            set: { code: NO_TRANSPORT_CODE }
          },
          { label: 'Specialty care transport', when: { level: is('SCT') }, set: { code: 'A0434' } },
          { label: 'ALS2', when: { level: is('ALS2') }, set: { code: 'A0433' } },
          {
            label: 'ALS1 emergency',
            when: { level: is('ALS1'), emergency: is(true) },
            set: { code: 'A0427' }
          },
          { label: 'ALS1 non-emergency', when: { level: is('ALS1') }, set: { code: 'A0426' } },
          { label: 'BLS emergency', when: { emergency: is(true) }, set: { code: 'A0429' } }
        ],
        { code: 'A0428' }
      )
    )
  });
  g.ret('return');
  g.wire('entry.service', 'service.service');
  g.wire('entry.classification', 'base.classification');
  g.wire('service.level', 'base.level');
  g.wire('service.emergency', 'base.emergency');
  g.wire('service.deceased', 'base.deceased');
  g.wire('base.code', 'return.code');
  g.wire('base.rules', 'return.reasons');
  return g.def;
};

const mileageLines = (): GraphDef => {
  const g = rule(
    [P.classification(), P.service()],
    [
      d(
        'lines',
        CHARGE_LINES,
        'Mileage Lines',
        'The covered mileage line and the non-covered (A0888) line, or none when no miles are billed.'
      ),
      P.reasons('miles were or were not billed')
    ]
  );
  g.add('service', 'billing.service.break');
  g.add('mileage', 'std.table.decide', {
    label: 'Mileage',
    config: shared.decision(
      'billing.mileage-code',
      'Mileage',
      'Picks the HCPCS mileage code for trips that transported the patient, for the loaded miles that are covered.',
      table(
        [
          field('classification', 'string', 'Classification'),
          field('loadedMiles', 'number', 'Covered loaded miles')
        ],
        [field('code', { code: 'hcpcs' }, 'HCPCS code')],
        [
          {
            label: 'Loaded miles transported',
            when: {
              classification: { op: 'notOneOf', value: NO_TRANSPORT },
              loadedMiles: { op: 'gt', value: 0 }
            },
            set: { code: 'A0425' }
          }
        ]
      )
    )
  });
  g.add('nonCoveredOrZero', 'std.logic.coalesce', {
    label: 'Non-Covered Miles or 0',
    values: { fallback: 0 }
  });
  g.add('less', 'std.math.subtract', { label: 'Loaded Miles Less Non-Covered Miles' });
  g.add('covered', 'std.math.round', { label: 'Covered Miles', values: { digits: 2 } });
  g.add('miles', 'std.logic.coalesce', { label: 'Covered Miles or 0', values: { fallback: 0 } });
  g.add('line', 'billing.line.make', { label: 'Mileage Line' });
  g.add('keep', 'std.logic.select', { label: 'Only When Miles Are Billed' });
  g.add('nonCovered', 'std.table.decide', {
    label: 'Non-Covered Mileage',
    config: shared.decision(
      'billing.non-covered-mileage-code',
      'Non-Covered Mileage',
      'Picks the HCPCS code for miles beyond the nearest appropriate facility, billed on their own line.',
      table(
        [
          field('classification', 'string', 'Classification'),
          field('nonCoveredMiles', 'number', 'Non-covered miles')
        ],
        [field('code', { code: 'hcpcs' }, 'HCPCS code')],
        [
          {
            label: 'Miles beyond the nearest appropriate facility',
            when: {
              classification: { op: 'notOneOf', value: NO_TRANSPORT },
              nonCoveredMiles: { op: 'gt', value: 0 }
            },
            set: { code: 'A0888' }
          }
        ]
      )
    )
  });
  g.add('excess', 'billing.line.make', { label: 'Non-Covered Mileage Line' });
  g.add('keepExcess', 'std.logic.select', { label: 'Only When Non-Covered Miles Are Billed' });
  g.add('lines', 'std.list.make', { label: 'As a List', config: { count: 2 } });
  g.add('reasons', 'std.list.concat', { label: 'Both Tables' });
  g.ret('return');
  g.wire('entry.service', 'service.service');
  g.wire('entry.classification', 'mileage.classification', 'nonCovered.classification');
  g.wire('service.loadedMiles', 'less.a');
  g.wire('service.nonCoveredMiles', 'nonCoveredOrZero.value', 'nonCovered.nonCoveredMiles');
  g.wire('nonCoveredOrZero.result', 'less.b');
  g.wire('less.result', 'covered.value');
  g.wire('service.nonCoveredMiles', 'excess.units');
  g.wire('covered.result', 'mileage.loadedMiles', 'miles.value');
  g.wire('mileage.code', 'line.code');
  g.wire('miles.result', 'line.units');
  g.wire('mileage.matched', 'keep.condition');
  g.wire('line.line', 'keep.whenTrue');
  g.wire('nonCovered.code', 'excess.code');
  g.wire('nonCovered.matched', 'keepExcess.condition');
  g.wire('excess.line', 'keepExcess.whenTrue');
  g.wire('keep.result', 'lines.item1');
  g.wire('keepExcess.result', 'lines.item2');
  g.wire('lines.list', 'return.lines');
  g.wire('mileage.rules', 'reasons.list');
  g.wire('nonCovered.rules', 'reasons.other');
  g.wire('reasons.list', 'return.reasons');
  return g.def;
};

const mapCharges = (): GraphDef => {
  const g = rule([P.classification(), P.service()], [LINES_OUT]);
  g.add('base', 'billing.base-rate-code', { label: 'Base Rate Code' });
  g.add('baseLine', 'billing.line.make', { label: 'Base Rate Line', values: { units: 1 } });
  g.add('baseLines', 'std.list.make', { label: 'Base Rate First', config: { count: 1 } });
  g.add('mileage', 'billing.mileage-lines', { label: 'Mileage Lines' });
  g.add('lines', 'std.list.concat', { label: 'Then Mileage' });
  g.ret('return');
  g.wire('entry.classification', 'base.classification', 'mileage.classification');
  g.wire('entry.service', 'base.service', 'mileage.service');
  g.wire('base.code', 'baseLine.code');
  g.wire('baseLine.line', 'baseLines.item1');
  g.wire('baseLines.list', 'lines.list');
  g.wire('mileage.lines', 'lines.other');
  g.wire('lines.list', 'return.lines');
  return g.def;
};

const pricePrecedence = (): GraphDef => {
  const g = rule(
    [
      d(
        'claimFees',
        FEES,
        'Claim Prices',
        'Unit prices a biller set for this claim, in cents.',
        true
      ),
      d('payerFees', FEES, 'Payer Prices', "The primary payer's fee schedule, in cents.", true),
      d('defaultFees', FEES, 'Default Prices', "The agency's default fee schedule, in cents.", true)
    ],
    [
      d('fees', FEES, 'Unit Prices', 'The price each code is billed at, in cents.'),
      P.reasons('each code got its price')
    ]
  );
  const none = { values: { fallback: {} } };
  g.add('defaults', 'std.logic.coalesce', { label: 'Default Prices or None', ...none });
  g.add('payer', 'std.logic.coalesce', { label: 'Payer Prices or None', ...none });
  g.add('claim', 'std.logic.coalesce', { label: 'Claim Prices or None', ...none });
  g.add('payerOverDefault', 'std.object.merge', { label: 'Payer, Else Default' });
  g.add('fees', 'std.object.merge', { label: 'Claim, Else Payer, Else Default' });
  g.add('codes', 'std.object.keys', { label: 'Codes Priced' });
  g.add('reasons', 'std.list.map-rule', {
    label: 'Where Each Price Came From',
    config: { rule: 'billing.price-source', version: 1, item: 'code' }
  });
  g.ret('return');
  g.wire('entry.defaultFees', 'defaults.value');
  g.wire('entry.payerFees', 'payer.value', 'reasons.payerFees');
  g.wire('entry.claimFees', 'claim.value', 'reasons.claimFees');
  g.wire('defaults.result', 'payerOverDefault.a');
  g.wire('payer.result', 'payerOverDefault.b');
  g.wire('payerOverDefault.object', 'fees.a');
  g.wire('claim.result', 'fees.b');
  g.wire('fees.object', 'codes.object', 'return.fees');
  g.wire('codes.keys', 'reasons.list');
  g.wire('reasons.reason', 'return.reasons');
  return g.def;
};

const priceSource = (): GraphDef => {
  const g = rule(
    [
      d('code', 'string', 'Code', 'The HCPCS code priced.'),
      d('claimFees', FEES, 'Claim Prices', 'Unit prices a biller set for this claim.', true),
      d('payerFees', FEES, 'Payer Prices', "The primary payer's fee schedule.", true)
    ],
    [d('reason', 'string', 'Price Source', 'The code and where its price came from.')]
  );
  g.add('onClaim', 'std.object.has', { label: 'Set for This Claim' });
  g.add('onPayer', 'std.object.has', { label: 'On the Payer Schedule' });
  g.add('payerOrDefault', 'std.logic.select', {
    label: 'Payer, Else Default Schedule',
    values: { whenTrue: 'payer fee schedule', whenFalse: 'default fee schedule' }
  });
  g.add('source', 'std.logic.select', {
    label: 'Where the Price Came From',
    values: { whenTrue: 'set for this claim' }
  });
  template(g, 'reason', 'Code and Source', '{code}: {source}', {
    code: 'entry.code',
    source: 'source.result'
  });
  g.ret('return');
  g.wire('entry.claimFees', 'onClaim.object');
  g.wire('entry.payerFees', 'onPayer.object');
  g.wire('entry.code', 'onClaim.key', 'onPayer.key');
  g.wire('onPayer.result', 'payerOrDefault.condition');
  g.wire('onClaim.result', 'source.condition');
  g.wire('payerOrDefault.result', 'source.whenFalse');
  g.wire('reason.text', 'return.reason');
  return g.def;
};

const chargeCodeText = (): GraphDef => {
  const g = rule(
    [d('code', { code: 'hcpcs' }, 'HCPCS Code', 'The code to name.')],
    [d('text', 'string', 'Code Text', 'The meaning of the code with the code, or the code.')]
  );
  g.add('meaning', 'std.table.lookup', {
    label: 'HCPCS Meaning',
    config: {
      type: 'string',
      rows: Object.entries(hcpcsDescriptions()).map(([key, value]) => ({ key, value }))
    }
  });
  template(g, 'described', 'Meaning (Code)', '[{meaning} ({code})]', {
    meaning: 'meaning.value',
    code: 'entry.code'
  });
  g.add('text', 'std.logic.choose', {
    label: 'Meaning (Code), Else Code',
    config: { mode: 'first', type: 'string', count: 2 }
  });
  g.ret('return');
  g.wire('entry.code', 'meaning.key', 'text.option2');
  g.wire('described.text', 'text.option1');
  g.wire('text.value', 'return.text');
  return g.def;
};

const PRICED_OUT = [
  d('lines', T.lines, 'Priced Lines', 'The lines with unit prices and totals.', true),
  d('totalCents', 'integer', 'Total (Cents)', 'The claim total.', true)
];

const PAYER_IN = d(
  'payerId',
  { id: 'payer' },
  'Primary Payer',
  'The directory payer whose prices come first, or nothing for the default fee schedule.',
  true
);

const PRICE_EXITS = {
  priced: exit('Priced', 'Every line has a price.'),
  voided: exit('Voided', 'A biller voided the claim instead of pricing a code.')
};

const priceCharges = (): GraphDef => {
  const g = stage(
    [
      d('lines', CHARGE_LINES, 'Charge Lines', 'The lines to price.'),
      PAYER_IN,
      P.subject(),
      P.context()
    ],
    PRICED_OUT,
    PRICE_EXITS,
    [{ name: 'fees', type: FEES, default: {} }]
  );
  g.add('claimFees', 'std.var.get', { label: 'Prices Set Here', config: { name: 'fees' } });
  g.add('find', 'billing.find-fees', { label: 'Find Fees' });
  g.add('precedence', 'billing.price-precedence', { label: 'Price Precedence' });
  g.add('price', 'billing.price-lines', { label: 'Price Lines' });
  g.add('missingCount', 'std.list.length', { label: 'Codes Without a Price' });
  g.add('allPriced', 'std.logic.equal', { label: 'None Missing', values: { b: 0 } });
  g.add('check', 'std.flow.branch', { label: 'Every Code Priced?' });
  g.add('codeTexts', 'std.list.map-rule', {
    label: 'Codes Named',
    config: { rule: 'billing.charge-code-text', version: 1, item: 'code' }
  });
  g.add('primaryPayer', 'std.logic.choose', {
    label: 'Primary Payer, Else Default Schedule',
    config: { mode: 'first', type: 'any', count: 2 },
    values: { option2: 'No directory payer, so the default fee schedule' }
  });
  g.add('setContext', 'std.object.make', {
    label: 'Missing Fees',
    config: {
      fields: [
        { name: 'codes', type: { list: 'string' } },
        { name: 'primaryPayer', type: 'any' },
        { name: 'claim', type: 'any' }
      ]
    }
  });
  g.add('codeChoices', 'std.object.make', {
    label: 'Codes Without a Fee',
    config: { fields: [{ name: 'code', type: { list: { code: 'hcpcs' } } }] }
  });
  g.add('missingFirst', 'std.list.first', { label: 'First Code Without a Fee' });
  g.add('firstCode', 'std.object.make', {
    label: 'First Code',
    config: { fields: [{ name: 'code', type: { code: 'hcpcs' } }] }
  });
  g.add('codeList', 'std.text.join', { label: 'Codes Listed', values: { separator: '; ' } });
  g.add('several', 'std.text.template', {
    label: 'Several Codes Unpriced',
    config: {
      template: 'No fee schedule prices {codes}; enter their unit prices or void the claim'
    }
  });
  g.add('one', 'std.text.template', {
    label: 'One Code Unpriced',
    config: { template: 'No fee schedule prices {codes}; enter its unit price or void the claim' }
  });
  g.add('setChargeSummary', 'std.logic.choose', {
    label: 'Task Summary',
    config: { mode: 'byCase', type: 'string', cases: [{ when: '0' }, { when: '1' }] },
    values: { case1: 'A code on this claim has no price; enter its unit price or void the claim' }
  });
  g.add('setCharge', 'std.human.task', {
    label: 'Set Charge',
    config: {
      title: 'Set charge',
      queue: 'billing-review',
      instructions:
        "No fee schedule has a price for a code on this claim. Enter the unit price to bill it at, and save it to the agency's default fee schedule so later claims are priced too, or void the claim.",
      fields: [
        { name: 'code', type: { code: 'hcpcs' }, label: 'HCPCS code', required: ['price'] },
        {
          name: 'unitPrice',
          type: 'number',
          label: 'Unit price (dollars)',
          min: 0,
          required: ['price']
        },
        { name: 'saveToSchedule', type: 'boolean', label: 'Save to the default fee schedule' }
      ],
      outcomes: ['price', 'void'],
      hints: {
        price:
          'Prices the code at this amount, saving it to the fee schedule if asked; any other unpriced code comes next.',
        void: 'Voids the claim instead of pricing it.'
      },
      prefill: 'suggested'
    }
  });
  g.add('setFee', 'billing.set-fee');
  g.add('keep', 'std.var.set', { label: 'Keep the Price', config: { name: 'fees' } });
  g.ret('pricedDone', 'priced');
  g.ret('voidedDone', 'voided');
  g.wire('entry.exec', 'find.exec');
  g.wire('entry.lines', 'find.lines', 'price.lines');
  g.wire('entry.payerId', 'find.payerId', 'primaryPayer.option1');
  g.wire('claimFees.value', 'precedence.claimFees', 'setFee.fees');
  g.wire('find.payerFees', 'precedence.payerFees');
  g.wire('find.defaultFees', 'precedence.defaultFees');
  g.wire('precedence.fees', 'price.fees');
  g.wire('find.then', 'check.exec');
  g.wire('price.missing', 'missingCount.list');
  g.wire('missingCount.length', 'allPriced.a');
  g.wire('allPriced.result', 'check.condition');
  g.wire('check.true', 'pricedDone.exec');
  g.wire('price.lines', 'pricedDone.lines');
  g.wire('price.totalCents', 'pricedDone.totalCents');
  g.wire('check.false', 'setCharge.exec');
  g.wire('price.missing', 'codeTexts.list', 'codeChoices.code', 'missingFirst.list');
  g.wire('codeTexts.text', 'setContext.codes', 'codeList.items');
  g.wire('primaryPayer.value', 'setContext.primaryPayer');
  g.wire('entry.context', 'setContext.claim');
  g.wire('setContext.object', 'setCharge.context');
  g.wire('codeChoices.object', 'setCharge.options');
  g.wire('missingFirst.item', 'firstCode.code');
  g.wire('firstCode.object', 'setCharge.defaults');
  g.wire('entry.subject', 'setCharge.subject');
  g.wire('codeList.text', 'several.codes', 'one.codes');
  g.wire('missingCount.length', 'setChargeSummary.key');
  g.wire('one.text', 'setChargeSummary.case2');
  g.wire('several.text', 'setChargeSummary.otherwise');
  g.wire('setChargeSummary.value', 'setCharge.summary');
  g.wire('setCharge.price', 'setFee.exec');
  g.wire('setCharge.code', 'setFee.code');
  g.wire('setCharge.unitPrice', 'setFee.unitPrice');
  g.wire('setCharge.saveToSchedule', 'setFee.saveToSchedule');
  g.wire('setFee.then', 'keep.exec');
  g.wire('setFee.fees', 'keep.value');
  g.wire('keep.then', 'find.exec');
  g.wire('setCharge.void', 'voidedDone.exec');
  return g.def;
};

const assignCharges = (): GraphDef => {
  const g = stage(
    [P.classification(), P.service(), PAYER_IN, P.subject(), P.context()],
    PRICED_OUT,
    PRICE_EXITS
  );
  g.add('charges', 'billing.map-charges', { label: 'Charges' });
  g.add('agency', 'billing.agency-charges', { label: 'Agency Charges' });
  g.add('price', 'billing.price-charges', { label: 'Price Charges' });
  g.ret('pricedDone', 'priced');
  g.ret('voidedDone', 'voided');
  g.wire('entry.exec', 'price.exec');
  g.wire('entry.classification', 'charges.classification', 'agency.classification');
  g.wire('entry.service', 'charges.service', 'agency.service');
  g.wire('charges.lines', 'agency.lines');
  g.wire('agency.lines', 'price.lines');
  g.wire('entry.payerId', 'price.payerId');
  g.wire('entry.subject', 'price.subject');
  g.wire('entry.context', 'price.context');
  g.wire('price.priced', 'pricedDone.exec');
  g.wire('price.lines', 'pricedDone.lines');
  g.wire('price.totalCents', 'pricedDone.totalCents');
  g.wire('price.voided', 'voidedDone.exec');
  return g.def;
};

const CHANGES = [
  'classification',
  'level',
  'emergency',
  'loadedMiles',
  'deceased',
  'nonCoveredMiles',
  'payers'
] as const;

const CHANGE_LABELS: Record<(typeof CHANGES)[number], string> = {
  classification: 'Classification',
  level: 'Level of service',
  emergency: 'Emergency status',
  loadedMiles: 'Loaded miles',
  deceased: 'Pronounced dead',
  nonCoveredMiles: 'Non-covered miles',
  payers: 'Payers'
};

const repriceTriggers = (): GraphDef => {
  const g = rule(
    [
      d(
        'changes',
        { object: {} },
        'What Changed',
        'Which claim fields an edit changed: classification, level, emergency, loadedMiles, deceased, nonCoveredMiles and payers.'
      )
    ],
    [
      d('reprice', 'boolean', 'Reprice', 'Whether the charges are mapped and priced again.'),
      P.reasons('the claim is or is not repriced')
    ]
  );
  g.add('changes', 'std.object.break', {
    label: 'Changed Fields',
    config: { fields: CHANGES.map((name) => ({ name, type: 'boolean' })) }
  });
  g.add('decide', 'std.table.decide', {
    label: 'Reprice Triggers',
    config: shared.decision(
      'billing.reprice-triggers',
      'Reprice Triggers',
      'Decides which claim edits map and price the charges again.',
      table(
        CHANGES.map((name) => field(name, 'boolean', `${CHANGE_LABELS[name]} changed`)),
        [field('reprice', 'boolean', 'Reprice')],
        CHANGES.map((name) => ({
          label: `${CHANGE_LABELS[name]} changed`,
          when: { [name]: is(true) },
          set: { reprice: true }
        })),
        { reprice: false }
      )
    )
  });
  g.ret('return');
  g.wire('entry.changes', 'changes.object');
  for (const name of CHANGES) g.wire(`changes.${name}`, `decide.${name}`);
  g.wire('decide.reprice', 'return.reprice');
  g.wire('decide.rules', 'return.reasons');
  return g.def;
};

const repriceClaim = (): GraphDef => {
  const g = stage(
    [P.claimId(), P.classification(), P.service(), PAYER_IN, P.subject(), P.context()],
    [],
    {
      repriced: exit('Repriced', 'The new charge lines are saved on the claim.'),
      voided: exit('Voided', 'A biller voided the claim instead of pricing a code.')
    }
  );
  g.add('charges', 'billing.assign-charges', { label: 'Assign Charges' });
  g.add('save', 'billing.patch-claim', { label: 'Save the Repriced Lines' });
  g.ret('repricedDone', 'repriced');
  g.ret('voidedDone', 'voided');
  g.wire('entry.exec', 'charges.exec');
  for (const pin of ['classification', 'service', 'payerId', 'subject', 'context']) {
    g.wire(`entry.${pin}`, `charges.${pin}`);
  }
  g.wire('charges.priced', 'save.exec');
  g.wire('charges.lines', 'save.lines');
  g.wire('entry.claimId', 'save.claimId');
  g.wire('save.then', 'repricedDone.exec');
  g.wire('charges.voided', 'voidedDone.exec');
  return g.def;
};

export const chargeGraphs: SeedGraph[] = [
  slot(
    'billing.agency-charges',
    'Agency Charges',
    'An agency rule after the base charges: add, change or drop charge lines before they are priced. Passes the lines through unchanged until an agency overrides it.',
    {
      execIn: [],
      execOut: [],
      inputs: [
        d('lines', CHARGE_LINES, 'Charge Lines', 'The HCPCS lines the base rules charged.'),
        d('classification', 'string', 'Classification', 'The confirmed classification.', true),
        d(
          'service',
          T.service,
          'Service',
          'The confirmed level of service, emergency and loaded miles.',
          true
        )
      ],
      outputs: [d('lines', CHARGE_LINES, 'Charge Lines', 'The lines to price and bill.')]
    }
  ),
  asRule(
    'billing.base-rate-code',
    'Base Rate Code',
    'Picks the HCPCS base rate by classification, level and emergency (Base Rate table): A0429/A0428 when pronounced dead before loading, A0998 without transport, A0434 SCT, A0433 ALS2, A0427/A0426 ALS1, A0429/A0428 BLS.',
    baseRateCode()
  ),
  asRule(
    'billing.mileage-lines',
    'Mileage Lines',
    'Bills A0425 for the covered loaded miles of trips that transported the patient (Mileage table), and A0888 for miles beyond the nearest appropriate facility (Non-Covered Mileage table); units are rounded up to the tenth, or to the whole mile from 100 miles, when priced.',
    mileageLines()
  ),
  asRule(
    'billing.map-charges',
    'Map Charges',
    'Turns a confirmed service into HCPCS lines: the Base Rate Code line, then Mileage Lines.',
    mapCharges()
  ),
  asRule(
    'billing.price-source',
    'Price Source',
    "Says where a code's unit price came from: set for this claim, the payer fee schedule or the default fee schedule.",
    priceSource()
  ),
  asRule(
    'billing.price-precedence',
    'Price Precedence',
    "Chooses each code's unit price: a price a biller set for this claim, else the primary payer's fee schedule, else the agency's default fee schedule, with where each came from (Price Source).",
    pricePrecedence()
  ),
  asRule(
    'billing.charge-code-text',
    'Charge Code Text',
    'Names an HCPCS code as its meaning followed by the code in parentheses, or the code alone when its meaning is not known.',
    chargeCodeText()
  ),
  asStage(
    'billing.price-charges',
    'Price Charges',
    'Finds the fee schedules for the lines, prices them by Price Precedence, and asks a biller for the price of any code without one (optionally saving it to the default schedule) before going on, or voids.',
    priceCharges()
  ),
  asStage(
    'billing.assign-charges',
    'Assign Charges',
    'Maps the classification and service to charge lines (Map Charges, then the Agency Charges rule) and prices them for the primary payer, or voids.',
    assignCharges()
  ),
  asRule(
    'billing.reprice-triggers',
    'Reprice Triggers',
    'Decides whether a claim edit maps and prices the charges again (Reprice Triggers table): a changed classification, level, emergency status, loaded or non-covered miles, pronounced-dead status or payers does.',
    repriceTriggers()
  ),
  asStage(
    'billing.reprice-claim',
    'Reprice Claim',
    'Assigns the charges again for the classification and service, priced for the payer (asking for any missing fee), and saves the new lines on the claim, or voids.',
    repriceClaim()
  )
];
