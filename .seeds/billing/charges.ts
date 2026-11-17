import { NO_TRANSPORT_CODE } from '@ugula/billing';
import type { GraphDef, ValueType } from '@ugula/graph';
import { hcpcsDescriptions } from '../codes.ts';
import type { SeedGraph } from '../graphs.ts';
import {
  asRule,
  asStage,
  CHARGE_LINES,
  condition,
  d,
  exit,
  FEES,
  field,
  firstOf,
  fixed,
  getField,
  is,
  joinText,
  listItem,
  makeList,
  makeObject,
  orElse,
  P,
  type Port,
  reasonsOf,
  rule,
  select,
  shared,
  stage,
  T,
  table,
  template
} from './shared.ts';

const NO_TRANSPORT = ['treatNoTransport', 'refusal'];

const LINE = T.lines.list;

const CHARGE_LINE = listItem(CHARGE_LINES);

const LINES_OUT = d('lines', CHARGE_LINES, 'Charge Lines', 'HCPCS codes and units to price.');

const CODE_OUT = d('code', { code: 'hcpcs' }, 'HCPCS Code', 'The HCPCS code to bill.');

const baseRateCode = (): GraphDef => {
  const g = rule(
    [P.classification(), P.service()],
    [CODE_OUT, P.reasons('this base rate was billed')]
  );
  g.add('service', 'billing.service.break', { label: 'Service' });
  const deceased: [ValueType, Port] = ['boolean', 'service.deceased'];
  const special = [
    {
      id: 'deadEmergency',
      label: 'Dead on an Emergency',
      reason: 'Pronounced dead before loading, emergency response',
      code: 'A0429',
      when: condition(
        g,
        'deadOnEmergency',
        'Pronounced Dead Before Loading on an Emergency',
        { deceased, emergency: ['boolean', 'service.emergency'] },
        [
          { field: 'deceased', op: 'is', value: true },
          { field: 'emergency', op: 'is', value: true }
        ]
      )
    },
    {
      id: 'dead',
      label: 'Dead Before Loading',
      reason: 'Pronounced dead before loading',
      code: 'A0428',
      when: condition(g, 'deadBeforeLoading', 'Pronounced Dead Before Loading', { deceased }, [
        { field: 'deceased', op: 'is', value: true }
      ])
    },
    {
      id: 'noTransport',
      label: 'Treated Only',
      reason: 'Treated without transport',
      code: NO_TRANSPORT_CODE,
      when: condition(
        g,
        'treatedOnly',
        'Treated Without Transport',
        { classification: ['string', 'entry.classification'] },
        [{ field: 'classification', op: 'oneOf', value: NO_TRANSPORT }]
      )
    }
  ];
  g.add('base', 'std.table.decide', {
    label: 'Base Rate',
    config: shared.decision(
      'billing.base-rate',
      'Base Rate',
      'Picks the HCPCS base rate code from the level of service and emergency status.',
      table(
        [field('level', 'string', 'Level of Service'), field('emergency', 'boolean', 'Emergency')],
        [field('code', { code: 'hcpcs' }, 'HCPCS Code')],
        [
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
  const code = firstOf(
    g,
    'code',
    'Special Case, Else the Base Rate',
    { code: 'hcpcs' },
    special.map((c) => ({
      id: `${c.id}Code`,
      label: `${c.label} Code`,
      when: c.when,
      value: fixed(c.code)
    })),
    'base.code'
  );
  const held = reasonsOf(
    g,
    'special',
    'Special Cases That Held',
    special.map((c) => ({
      id: `${c.id}Reason`,
      label: `${c.label} Reason`,
      when: c.when,
      reason: c.reason
    }))
  );
  g.add('reasons', 'std.list.concat', { label: 'Special Cases, Then Base Rates' });
  g.ret('return');
  g.wire('entry.service', 'service.service');
  g.wire('service.level', 'base.level');
  g.wire('service.emergency', 'base.emergency');
  g.wire(code, 'return.code');
  g.wire(held, 'reasons.list');
  g.wire('base.rules', 'reasons.other');
  g.wire('reasons.list', 'return.reasons');
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
  g.add('service', 'billing.service.break', { label: 'Service' });
  const transported = condition(
    g,
    'transported',
    'The Trip Transported the Patient',
    { classification: ['string', 'entry.classification'] },
    [{ field: 'classification', op: 'notOneOf', value: NO_TRANSPORT }]
  );
  const nonCoveredOrZero = orElse(
    g,
    'nonCoveredOrZero',
    'Non-Covered Miles, Else 0',
    'service.nonCoveredMiles',
    fixed(0),
    'number'
  );
  g.add('less', 'std.math.subtract', { label: 'Loaded Miles Less Non-Covered Miles' });
  g.add('covered', 'std.math.round', { label: 'Covered Miles', values: { digits: 2 } });
  const miles = orElse(g, 'miles', 'Covered Miles, Else 0', 'covered.result', fixed(0), 'number');
  const billed = (id: string, label: string, miles: Port) =>
    condition(g, id, label, { transported: ['boolean', transported], miles: ['number', miles] }, [
      { field: 'transported', op: 'is', value: true },
      { field: 'miles', op: 'gt', value: 0 }
    ]);
  const covered = billed('coveredBilled', 'Covered Loaded Miles on a Transport', 'covered.result');
  const nonCovered = billed(
    'nonCoveredBilled',
    'Miles Beyond the Nearest Appropriate Facility',
    'service.nonCoveredMiles'
  );
  g.add('line', 'billing.line.make', { label: 'Mileage Line', values: { code: 'A0425' } });
  const keep = select(g, 'keep', 'Mileage Line When Miles Are Billed', covered, 'line.line');
  g.add('excess', 'billing.line.make', {
    label: 'Non-Covered Mileage Line',
    values: { code: 'A0888' }
  });
  const keepExcess = select(
    g,
    'keepExcess',
    'Non-Covered Line When Non-Covered Miles Are Billed',
    nonCovered,
    'excess.line'
  );
  const lines = makeList(g, 'lines', 'Mileage Lines', LINE, [keep, keepExcess]);
  const reasons = reasonsOf(g, 'reasons', 'Mileage Billed', [
    {
      id: 'coveredReason',
      label: 'Covered Miles Reason',
      when: covered,
      reason: 'Covered loaded miles on a transport'
    },
    {
      id: 'nonCoveredReason',
      label: 'Non-Covered Miles Reason',
      when: nonCovered,
      reason: 'Miles beyond the nearest appropriate facility'
    }
  ]);
  g.ret('return');
  g.wire('entry.service', 'service.service');
  g.wire('service.loadedMiles', 'less.a');
  g.wire('service.nonCoveredMiles', 'excess.units');
  g.wire(nonCoveredOrZero, 'less.b');
  g.wire('less.result', 'covered.value');
  g.wire(miles, 'line.units');
  g.wire(lines, 'return.lines');
  g.wire(reasons, 'return.reasons');
  return g.def;
};

const ROUNDING = {
  wholeFrom: 'Whole Units From',
  wholeDigits: 'Decimals from There',
  belowDigits: 'Decimals Below'
} as const;

const MILEAGE_ROUNDING = shared.lookup(
  'billing.unit-rounding',
  'Unit Rounding',
  'How units are rounded up before they are priced and billed, as Medicare asks for mileage: below Whole Units From (100) to Decimals Below (1, tenths of a mile), and from there to Decimals from There (0, whole miles).',
  {
    type: 'integer',
    rows: [
      { key: ROUNDING.wholeFrom, value: 100 },
      { key: ROUNDING.wholeDigits, value: 0 },
      { key: ROUNDING.belowDigits, value: 1 }
    ]
  }
);

const billedUnits = (): GraphDef => {
  const g = rule(
    [d('units', 'number', 'Units', 'The units charged, such as loaded miles.', true)],
    [d('units', 'number', 'Billed Units', 'The units rounded up to what is billed.', true)]
  );
  const setting = (id: keyof typeof ROUNDING) => {
    g.add(id, 'std.table.lookup', {
      label: ROUNDING[id],
      config: MILEAGE_ROUNDING,
      values: { key: ROUNDING[id] }
    });
    return `${id}.value` as const;
  };
  const whole = condition(
    g,
    'whole',
    'At or Above Whole Units From',
    { units: ['number', 'entry.units'], from: ['integer', setting('wholeFrom')] },
    [{ field: 'units', op: 'gte', input: 'from' }]
  );
  const up = (id: string, label: string, digits: Port) => {
    g.add(id, 'std.math.round', { label, config: { direction: 'up' } });
    g.wire('entry.units', `${id}.value`);
    g.wire(digits, `${id}.digits`);
    return `${id}.result` as const;
  };
  g.ret('return');
  g.wire(
    select(
      g,
      'billed',
      'Whole Units, Else Tenths',
      whole,
      up('upWhole', 'Rounded Up from There', setting('wholeDigits')),
      up('upBelow', 'Rounded Up Below', setting('belowDigits'))
    ),
    'return.units'
  );
  return g.def;
};

const billedLine = (): GraphDef => {
  const g = rule(
    [d('line', CHARGE_LINE, 'Charge Line', 'An HCPCS code and the units charged.')],
    [d('line', CHARGE_LINE, 'Billed Line', 'The line with its units rounded up to what is billed.')]
  );
  g.add('billed', 'billing.billed-units', { label: 'Billed Units' });
  g.add('set', 'std.object.set-field', {
    label: 'Line with Billed Units',
    config: { record: CHARGE_LINE, path: 'units' }
  });
  g.ret('return');
  g.wire(getField(g, 'units', 'Units', CHARGE_LINE, 'units', 'entry.line'), 'billed.units');
  g.wire('entry.line', 'set.record');
  g.wire('billed.units', 'set.value');
  g.wire('set.record', 'return.line');
  return g.def;
};

const mapCharges = (): GraphDef => {
  const g = rule([P.classification(), P.service()], [LINES_OUT]);
  g.add('base', 'billing.base-rate-code', { label: 'Base Rate Code' });
  g.add('baseLine', 'billing.line.make', { label: 'Base Rate Line', values: { units: 1 } });
  const baseLines = makeList(g, 'baseLines', 'Base Rate First', LINE, ['baseLine.line']);
  g.add('mileage', 'billing.mileage-lines', { label: 'Mileage Lines' });
  g.add('lines', 'std.list.concat', { label: 'Then Mileage' });
  g.ret('return');
  g.wire('entry.classification', 'base.classification', 'mileage.classification');
  g.wire('entry.service', 'base.service', 'mileage.service');
  g.wire('base.code', 'baseLine.code');
  g.wire(baseLines, 'lines.list');
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
  const none = (id: string, label: string, fees: Port) =>
    orElse(g, id, label, fees, fixed({}), FEES);
  const defaults = none('defaults', 'Default Prices, Else None', 'entry.defaultFees');
  const payer = none('payer', 'Payer Prices, Else None', 'entry.payerFees');
  const claim = none('claim', 'Claim Prices, Else None', 'entry.claimFees');
  g.add('payerOverDefault', 'std.object.merge', { label: 'Payer, Else Default' });
  g.add('fees', 'std.object.merge', { label: 'Claim, Else Payer, Else Default' });
  g.add('codes', 'std.object.keys', { label: 'Codes Priced' });
  g.add('reasons', 'std.list.map-rule', {
    label: 'Where Each Price Came From',
    config: { rule: 'billing.price-source', version: 1, item: 'code' }
  });
  g.ret('return');
  g.wire('entry.payerFees', 'reasons.payerFees');
  g.wire('entry.claimFees', 'reasons.claimFees');
  g.wire(defaults, 'payerOverDefault.a');
  g.wire(payer, 'payerOverDefault.b');
  g.wire('payerOverDefault.object', 'fees.a');
  g.wire(claim, 'fees.b');
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
  const schedule = select(
    g,
    'payerOrDefault',
    'Payer, Else Default Schedule',
    'onPayer.result',
    fixed('payer fee schedule'),
    fixed('default fee schedule')
  );
  const source = select(
    g,
    'source',
    'Set for This Claim, Else the Schedule',
    'onClaim.result',
    fixed('set for this claim'),
    schedule
  );
  const reason = template(g, 'reason', 'Code and Source', '{code}: {source}', {
    code: 'entry.code',
    source
  });
  g.ret('return');
  g.wire('entry.claimFees', 'onClaim.object');
  g.wire('entry.payerFees', 'onPayer.object');
  g.wire('entry.code', 'onClaim.key', 'onPayer.key');
  g.wire(reason, 'return.reason');
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
  g.ret('return');
  g.wire('entry.code', 'meaning.key');
  g.wire(
    orElse(g, 'text', 'Meaning (Code), Else Code', 'described.text', 'entry.code'),
    'return.text'
  );
  return g.def;
};

const MISSING: ValueType = { list: { code: 'hcpcs' } };

const unpricedCodes = (): GraphDef => {
  const g = rule(
    [d('codes', MISSING, 'Codes Without a Price', 'The HCPCS codes no fee schedule prices.')],
    [
      d('named', { list: 'string' }, 'Codes Named', 'Each code with its meaning.'),
      d('summary', 'string', 'Summary', 'What the biller is asked to price, naming the codes.')
    ]
  );
  g.add('named', 'std.list.map-rule', {
    label: 'Codes Named',
    config: { rule: 'billing.charge-code-text', version: 1, item: 'code' }
  });
  g.add('count', 'std.list.length', { label: 'How Many Codes' });
  const listed = joinText(g, 'listed', 'Codes Listed', '; ', 'named.text');
  const several = template(
    g,
    'several',
    'Several Codes Unpriced',
    'No fee schedule prices {codes}; enter their unit prices or void the claim',
    { codes: listed }
  );
  const one = template(
    g,
    'one',
    'One Code Unpriced',
    'No fee schedule prices {codes}; enter its unit price or void the claim',
    { codes: listed }
  );
  g.add('summary', 'std.logic.choose', {
    label: 'One or Several',
    config: { mode: 'byCase', type: 'string', cases: [{ when: '1' }] }
  });
  g.ret('return');
  g.wire('entry.codes', 'named.list', 'count.list');
  g.wire('named.text', 'return.named');
  g.wire('count.length', 'summary.key');
  g.wire(one, 'summary.case1');
  g.wire(several, 'summary.otherwise');
  g.wire('summary.value', 'return.summary');
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

const assignCharges = (): GraphDef => {
  const g = stage(
    [P.classification(), P.service(), PAYER_IN, P.subject(), P.context()],
    PRICED_OUT,
    PRICE_EXITS,
    [{ name: 'fees', type: FEES, default: {} }]
  );
  g.add('charges', 'billing.map-charges', { label: 'Map Charges' });
  g.wire('entry.classification', 'charges.classification');
  g.wire('entry.service', 'charges.service');
  g.add('billed', 'std.list.map-rule', {
    label: 'Billed Units of Each Line',
    config: { rule: 'billing.billed-line', version: 1, item: 'line' }
  });
  g.add('claimFees', 'std.var.get', { label: 'Prices Set Here', config: { name: 'fees' } });
  g.add('find', 'billing.find-fees', { label: 'Find Fees' });
  g.add('precedence', 'billing.price-precedence', { label: 'Price Precedence' });
  g.add('price', 'billing.price-lines', { label: 'Price Lines' });
  const allPriced = condition(
    g,
    'allPriced',
    'Every Code Has a Price',
    { missing: [MISSING, 'price.missing'] },
    [{ field: 'missing', op: 'empty' }]
  );
  g.add('check', 'std.flow.branch', { label: 'Every Code Priced?' });
  g.add('unpriced', 'billing.unpriced-codes', { label: 'Unpriced Codes' });
  const primaryPayer = orElse(
    g,
    'primaryPayer',
    'Primary Payer, Else Default Schedule',
    'entry.payerId',
    fixed('No directory payer, so the default fee schedule'),
    'any'
  );
  const context = makeObject(g, 'setContext', 'Missing Fees', {
    codes: [{ list: 'string' }, 'unpriced.named'],
    primaryPayer: ['any', primaryPayer],
    claim: ['any', 'entry.context']
  });
  const options = makeObject(g, 'codeChoices', 'Codes Without a Fee', {
    code: [MISSING, 'price.missing']
  });
  g.add('missingFirst', 'std.list.first', { label: 'First Code Without a Fee' });
  const defaults = makeObject(g, 'firstCode', 'First Code', {
    code: [{ code: 'hcpcs' }, 'missingFirst.item']
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
  g.add('setFee', 'billing.set-fee', { label: 'Set Fee' });
  g.add('keep', 'std.var.set', { label: 'Keep the Price', config: { name: 'fees' } });
  g.ret('pricedDone', 'priced');
  g.ret('voidedDone', 'voided');
  g.wire('entry.exec', 'find.exec');
  g.wire('charges.lines', 'billed.list');
  g.wire('billed.line', 'find.lines', 'price.lines');
  g.wire('entry.payerId', 'find.payerId');
  g.wire('claimFees.value', 'precedence.claimFees', 'setFee.fees');
  g.wire('find.payerFees', 'precedence.payerFees');
  g.wire('find.defaultFees', 'precedence.defaultFees');
  g.wire('precedence.fees', 'price.fees');
  g.wire('find.then', 'check.exec');
  g.wire(allPriced, 'check.condition');
  g.wire('check.true', 'pricedDone.exec');
  g.wire('price.lines', 'pricedDone.lines');
  g.wire('price.totalCents', 'pricedDone.totalCents');
  g.wire('check.false', 'setCharge.exec');
  g.wire('price.missing', 'unpriced.codes', 'missingFirst.list');
  g.wire(context, 'setCharge.context');
  g.wire(options, 'setCharge.options');
  g.wire(defaults, 'setCharge.defaults');
  g.wire('entry.subject', 'setCharge.subject');
  g.wire('unpriced.summary', 'setCharge.summary');
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

const CHANGES = [
  ['classification', 'Classification', 'The classification changed'],
  ['level', 'Level of Service', 'The level of service changed'],
  ['emergency', 'Emergency Status', 'The emergency status changed'],
  ['loadedMiles', 'Loaded Miles', 'The loaded miles changed'],
  ['deceased', 'Pronounced Dead', 'Whether the patient was pronounced dead changed'],
  ['nonCoveredMiles', 'Non-Covered Miles', 'The non-covered miles changed'],
  ['payers', 'Payers', 'The payers changed']
] as const;

const repriceTriggers = (): GraphDef => {
  const g = rule(
    [
      d(
        'changes',
        { object: {} },
        'What Changed',
        `Which claim fields an edit changed, each true or false, by these field names: ${CHANGES.map(([name]) => name).join(', ')}.`
      )
    ],
    [
      d('reprice', 'boolean', 'Reprice', 'Whether the charges are mapped and priced again.'),
      P.reasons('the claim is or is not repriced')
    ]
  );
  g.add('changes', 'std.object.break', {
    label: 'Changed Fields',
    config: { fields: CHANGES.map(([name]) => ({ name, type: 'boolean' })) }
  });
  const reasons = reasonsOf(
    g,
    'reasons',
    'What Changed',
    CHANGES.map(([name, label, reason]) => ({
      id: `${name}Reason`,
      label: `${label} Reason`,
      when: condition(
        g,
        `${name}Changed`,
        `${label} Changed`,
        { [name]: ['boolean', `changes.${name}`] },
        [{ field: name, op: 'is', value: true }]
      ),
      reason
    }))
  );
  const reprice = condition(
    g,
    'reprice',
    'Any Change That Reprices',
    { reasons: [{ list: 'string' }, reasons] },
    [{ field: 'reasons', op: 'present' }]
  );
  g.ret('return');
  g.wire('entry.changes', 'changes.object');
  g.wire(reprice, 'return.reprice');
  g.wire(reasons, 'return.reasons');
  return g.def;
};

const repriceClaim = (): GraphDef => {
  const g = stage(
    [P.claimId(), P.classification(), P.service(), PAYER_IN, P.subject(), P.context()],
    [],
    {
      repriced: exit('Repriced', 'The new charge lines are saved on the claim.'),
      voided: PRICE_EXITS.voided
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
  asRule(
    'billing.base-rate-code',
    'Base Rate Code',
    'Picks the HCPCS base rate code: A0429 or A0428 when the patient was pronounced dead before loading (emergency or not), A0998 when treated without transport, else the Base Rate table by level of service and emergency status: A0434 for SCT, A0433 for ALS2, A0427 or A0426 for ALS1, and A0429 or A0428 for BLS.',
    baseRateCode()
  ),
  asRule(
    'billing.mileage-lines',
    'Mileage Lines',
    'Bills A0425 for the covered loaded miles of trips that transported the patient, and A0888 for miles beyond the nearest appropriate facility; Billed Units rounds them up when they are priced.',
    mileageLines()
  ),
  asRule(
    'billing.billed-units',
    'Billed Units',
    'Rounds units up to what is billed (Unit Rounding table): to the tenth of a mile below 100, and to the whole mile from 100.',
    billedUnits()
  ),
  asRule(
    'billing.billed-line',
    'Billed Line',
    'Rounds the units of a charge line up to what is billed, with Billed Units.',
    billedLine()
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
  asRule(
    'billing.unpriced-codes',
    'Unpriced Codes',
    'Names the codes no fee schedule prices, each with its meaning (Charge Code Text), and says what the biller is asked to price.',
    unpricedCodes()
  ),
  asStage(
    'billing.assign-charges',
    'Assign Charges',
    'Maps the classification and service to charge lines (Map Charges), rounds each line to its Billed Units, finds the fee schedules, prices the lines by Price Precedence, and asks a biller for the price of any code without one (optionally saving it to the default schedule) before going on, or voids.',
    assignCharges()
  ),
  asRule(
    'billing.reprice-triggers',
    'Reprice Triggers',
    'Decides whether a claim edit maps and prices the charges again: a changed classification, level, emergency status, loaded or non-covered miles, pronounced-dead status or payers does.',
    repriceTriggers()
  ),
  asStage(
    'billing.reprice-claim',
    'Reprice Claim',
    'Assigns the charges again for the classification and service, priced for the payer (asking for any missing fee), and saves the new lines on the claim, or voids.',
    repriceClaim()
  )
];
