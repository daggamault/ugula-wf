import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import { asRule, d, rule, T } from './shared.ts';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

const placeText = (): GraphDef => {
  const g = rule(
    [d('place', { object: {} }, 'Place', 'An address: street, city and ZIP code.', true)],
    [d('text', 'string', 'Place Text', 'The street, city and ZIP code, separated by commas.')]
  );
  g.add('parts', 'std.object.break', {
    label: 'Address',
    config: {
      fields: [
        { name: 'addressLine', type: 'string' },
        { name: 'city', type: 'string' },
        { name: 'postalCode', type: 'string' }
      ]
    }
  });
  g.add('cityCode', 'std.logic.condition', {
    label: 'City Is a Place Code',
    config: {
      inputs: [{ name: 'city', type: 'string' }],
      rules: [{ field: 'city', op: 'startsWith', value: DIGITS }]
    }
  });
  g.add('city', 'std.logic.select', { label: 'City Unless a Code' });
  g.add('list', 'std.list.make', {
    label: 'Street, City and ZIP',
    config: { count: 3, type: 'string' }
  });
  g.add('join', 'std.text.join', { label: 'With Commas', values: { separator: ', ' } });
  g.ret('return');
  g.wire('entry.place', 'parts.object');
  g.wire('parts.city', 'cityCode.city', 'city.whenFalse');
  g.wire('cityCode.result', 'city.condition');
  g.wire('parts.addressLine', 'list.item1');
  g.wire('city.result', 'list.item2');
  g.wire('parts.postalCode', 'list.item3');
  g.wire('list.list', 'join.items');
  g.wire('join.text', 'return.text');
  return g.def;
};

const blockingSummary = (): GraphDef => {
  const g = rule(
    [
      d('issues', T.issues, 'Issues', 'The issues found, with their severity.', true),
      d('billed', 'string', 'Billed', 'Who is billed, such as the payer or the patient.', true),
      d('otherwise', 'string', 'Otherwise', 'What to say when nothing blocks billing.', true)
    ],
    [d('summary', 'string', 'Summary', 'How many issues block billing and the first two.')]
  );
  g.add('blocking', 'std.list.where', {
    label: 'Blocking Issues',
    config: { field: 'severity', op: 'is', value: 'blocking' }
  });
  g.add('messages', 'std.list.pluck', { label: 'Their Messages', values: { field: 'message' } });
  g.add('firstTwo', 'std.list.slice', { label: 'First Two', values: { start: 0, end: 2 } });
  g.add('listed', 'std.text.join', { label: 'Joined', values: { separator: '; ' } });
  g.add('beyond', 'std.math.subtract', { label: 'Beyond Two', values: { b: 2 } });
  g.add('moreThanTwo', 'std.logic.condition', {
    label: 'More Than Two',
    config: {
      inputs: [{ name: 'count', type: 'integer' }],
      rules: [{ field: 'count', op: 'gt', value: 2 }]
    }
  });
  g.add('more', 'std.logic.select', { label: 'How Many More' });
  g.add('several', 'std.text.template', {
    label: 'Several Block',
    config: { template: '{count} issues block' }
  });
  g.add('lead', 'std.logic.choose', {
    label: 'One or Several',
    config: { mode: 'byCase', type: 'string', cases: [{ when: '1' }] },
    values: { case1: 'An issue blocks' }
  });
  g.add('text', 'std.text.template', {
    label: 'Blocking Text',
    config: { template: '{lead} billing {billed}: {listed}[; and {more} more]' }
  });
  g.add('none', 'std.logic.condition', {
    label: 'Nothing Blocks',
    config: {
      inputs: [{ name: 'count', type: 'integer' }],
      rules: [{ field: 'count', op: 'is', value: 0 }]
    }
  });
  g.add('summary', 'std.logic.select', { label: 'Summary' });
  g.ret('return');
  g.wire('entry.issues', 'blocking.list');
  g.wire('blocking.list', 'messages.list');
  g.wire('messages.list', 'firstTwo.list');
  g.wire('firstTwo.list', 'listed.items');
  g.wire('blocking.count', 'beyond.a', 'moreThanTwo.count', 'several.count', 'lead.key');
  g.wire('blocking.count', 'none.count');
  g.wire('moreThanTwo.result', 'more.condition');
  g.wire('beyond.result', 'more.whenTrue');
  g.wire('several.text', 'lead.otherwise');
  g.wire('lead.value', 'text.lead');
  g.wire('entry.billed', 'text.billed');
  g.wire('listed.text', 'text.listed');
  g.wire('more.result', 'text.more');
  g.wire('none.result', 'summary.condition');
  g.wire('entry.otherwise', 'summary.whenTrue');
  g.wire('text.text', 'summary.whenFalse');
  g.wire('summary.result', 'return.summary');
  return g.def;
};

export const displayGraphs: SeedGraph[] = [
  asRule(
    'billing.place-text',
    'Place Text',
    'Writes an address as its street, city and ZIP code, leaving out a city that is a NEMSIS place code.',
    placeText()
  ),
  asRule(
    'billing.blocking-summary',
    'Blocking Summary',
    'Says how many issues block billing and names the first two, or what to say when nothing blocks.',
    blockingSummary()
  )
];
