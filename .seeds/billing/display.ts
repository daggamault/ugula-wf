import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import { asRule, condition, d, joinText, makeList, rule, select, T, template } from './shared.ts';

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
  const cityCode = condition(
    g,
    'cityCode',
    'City Is a Place Code',
    { city: ['string', 'parts.city'] },
    [{ field: 'city', op: 'startsWith', value: DIGITS }]
  );
  const city = select(g, 'city', 'City Unless a Code', cityCode, undefined, 'parts.city');
  const parts = makeList(g, 'list', 'Street, City and ZIP', 'string', [
    'parts.addressLine',
    city,
    'parts.postalCode'
  ]);
  g.ret('return');
  g.wire('entry.place', 'parts.object');
  g.wire(joinText(g, 'join', 'With Commas', ', ', parts), 'return.text');
  return g.def;
};

const listPreview = (): GraphDef => {
  const g = rule(
    [
      d('items', { list: 'string' }, 'Items', 'The texts to list, in order.', true),
      d('shown', 'integer', 'How Many to Name', 'How many items to name before counting the rest.'),
      d('separator', 'string', 'Separator', 'What goes between the named items, such as "; ".')
    ],
    [
      d('listed', 'string', 'Listed', 'The first items named, joined by the separator.'),
      d('more', 'integer', 'How Many More', 'How many items are left unnamed.', true),
      d('count', 'integer', 'Count', 'How many items there are in all.')
    ]
  );
  g.add('first', 'std.list.slice', { label: 'First Items', values: { start: 0 } });
  g.add('count', 'std.list.length', { label: 'How Many' });
  g.add('beyond', 'std.math.subtract', { label: 'Beyond Those Named' });
  g.add('listed', 'std.text.join', { label: 'Listed' });
  const unnamed = condition(
    g,
    'someUnnamed',
    'Some Left Unnamed',
    { beyond: ['integer', 'beyond.result'] },
    [{ field: 'beyond', op: 'gt', value: 0 }]
  );
  g.ret('return');
  g.wire('entry.items', 'first.list', 'count.list');
  g.wire('entry.shown', 'first.end', 'beyond.b');
  g.wire('entry.separator', 'listed.separator');
  g.wire('first.list', 'listed.items');
  g.wire('count.length', 'beyond.a', 'return.count');
  g.wire('listed.text', 'return.listed');
  g.wire(select(g, 'more', 'How Many More', unnamed, 'beyond.result'), 'return.more');
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
  g.add('preview', 'billing.list-preview', {
    label: 'First Two Messages',
    values: { shown: 2, separator: '; ' }
  });
  g.add('lead', 'std.text.count', {
    label: 'How Many Block',
    values: { singular: 'issue blocks', plural: 'issues block' }
  });
  const text = template(
    g,
    'text',
    'Blocking Text',
    '{lead} billing {billed}: {listed}[; and {more} more]',
    {
      lead: 'lead.text',
      billed: 'entry.billed',
      listed: 'preview.listed',
      more: 'preview.more'
    }
  );
  const none = condition(g, 'none', 'Nothing Blocks', { count: ['integer', 'blocking.count'] }, [
    { field: 'count', op: 'is', value: 0 }
  ]);
  g.ret('return');
  g.wire('entry.issues', 'blocking.list');
  g.wire('blocking.list', 'messages.list');
  g.wire('messages.list', 'preview.items');
  g.wire('blocking.count', 'lead.count');
  g.wire(select(g, 'summary', 'Summary', none, 'entry.otherwise', text), 'return.summary');
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
    'billing.list-preview',
    'List Preview',
    'Names the first few items of a list and counts the rest, for summaries such as "a; b; and 3 more".',
    listPreview()
  ),
  asRule(
    'billing.blocking-summary',
    'Blocking Summary',
    'Says how many issues block billing and names the first two, or what to say when nothing blocks.',
    blockingSummary()
  )
];
