import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  anyOf,
  asRule,
  asStage,
  atLeast,
  breakRecord,
  code,
  d,
  ENCOUNTER,
  exit,
  firstSet,
  fixed,
  joinLists,
  keepWhere,
  listOf,
  makeList,
  n,
  node,
  not,
  QUEUE,
  rule,
  select,
  stage,
  startsWith,
  T,
  template
} from './shared.ts';

const ICD10 = code('icd10');

const MATCH = { object: { code: ICD10, description: 'string', score: 'number' } } as const;

const SEARCH_TEXT_LIMIT = 1_000;

const externalCause = (): GraphDef => {
  const g = rule(
    [d('diagnosis', ICD10, 'Diagnosis', 'One ICD-10-CM code.')],
    [d('result', 'boolean', 'Result', 'Whether it is an external cause code (V00 to Y99).')]
  );
  g.ret('return');
  g.wire(
    anyOf(
      g,
      'external',
      n(
        'External Cause',
        'An external cause tells how an injury happened and is never billed first.'
      ),
      ['V', 'W', 'X', 'Y'].map((letter) =>
        startsWith(
          g,
          `starts${letter}`,
          n(`Starts With ${letter}`, `External causes run from V00 to Y99.`),
          'entry.diagnosis',
          letter
        )
      )
    ),
    'return.result'
  );
  return g.def;
};

const notExternalCause = (): GraphDef => {
  const g = rule(
    [d('diagnosis', ICD10, 'Diagnosis', 'One ICD-10-CM code.')],
    [d('result', 'boolean', 'Result', 'Whether it may be billed first.')]
  );
  g.add('external', 'billing.external-cause', {
    label: 'External Cause',
    note: 'V00 to Y99 explain an injury and are never first.'
  });
  g.wire('entry.diagnosis', 'external.diagnosis');
  g.ret('return');
  g.wire(
    not(g, 'first', n('May Be Billed First', 'Anything but an external cause.'), 'external.result'),
    'return.result'
  );
  return g.def;
};

const suggestion = (): GraphDef => {
  const g = rule(
    [d('match', MATCH, 'Match', 'One code Search Diagnoses found.')],
    [d('text', 'string', 'Text', 'The code, its description and its score, for a coder to read.')]
  );
  g.add('parts', 'std.object.break', {
    label: 'Match',
    note: 'The code, description and score.',
    config: {
      fields: [
        { name: 'code', type: ICD10 },
        { name: 'description', type: 'string' },
        { name: 'score', type: 'number' }
      ]
    }
  });
  g.wire('entry.match', 'parts.object');
  g.ret('return');
  g.wire(
    template(
      g,
      'text',
      n('Suggestion', 'How a coder sees one match.'),
      'Suggested: {code} {description} (closeness {score})',
      { code: 'parts.code', description: 'parts.description', score: 'parts.score' }
    ),
    'return.text'
  );
  return g.def;
};

const codeDiagnoses = (): GraphDef => {
  const g = stage(
    [
      d('encounter', T.encounter, 'Encounter', 'The encounter to code.'),
      d(
        'reported',
        listOf(ICD10),
        'Reported Diagnoses',
        'The impressions and symptoms as reported.'
      )
    ],
    [
      d(
        'diagnoses',
        listOf(ICD10),
        'Diagnoses',
        'The billable diagnoses, the first one billable first.'
      ),
      d(
        'reasons',
        listOf('string'),
        'Reasons',
        'What changed from the report, and what a coder chose.'
      )
    ],
    {
      coded: exit('Coded', 'The claim has a billable first diagnosis, from the report or a coder.')
    },
    [{ name: 'chosen', type: listOf(ICD10), default: [] }]
  );
  breakRecord(
    g,
    'trip',
    n('Encounter', 'The complaint and narrative to search.'),
    ENCOUNTER,
    'entry.encounter'
  );
  g.add('check', 'diagnosis.check', {
    label: 'Check Diagnoses',
    note: 'Keeps only billable ICD-10-CM codes, written without the dot.'
  });
  g.wire('entry.reported', 'check.codes');
  const firsts = keepWhere(
    g,
    'firsts',
    n('May Be Billed First', 'Billable codes that are not external causes.'),
    'billing.not-external-cause',
    'diagnosis',
    'check.billable'
  );
  const causes = keepWhere(
    g,
    'causes',
    n('External Causes', 'Kept, but after the others.'),
    'billing.external-cause',
    'diagnosis',
    'check.billable'
  );
  g.add('hasFirst', 'std.flow.branch', {
    label: 'Has a First Diagnosis',
    note: 'Without one, a coder chooses from a search of the complaint and narrative.'
  });
  atLeast(
    g,
    'firstFound',
    n('First Diagnosis Found', 'At least one may be billed first.'),
    'integer',
    `${firsts}.count`,
    1
  );
  const query = firstSet(
    g,
    'query',
    n('What to Search', 'The complaint, else the narrative.'),
    'string',
    ['trip.complaint', 'trip.narrative']
  );
  node(
    g,
    'queryText',
    'std.text.substring',
    n('Search Text', 'Searches the start of a long narrative.'),
    {
      text: query,
      start: fixed(0),
      end: fixed(SEARCH_TEXT_LIMIT)
    }
  );
  g.add('search', 'diagnosis.search', {
    label: 'Search Diagnoses',
    note: 'Finds the EMS impressions and symptoms that mean the closest.'
  });
  g.wire('queryText.result', 'search.text');
  g.add('suggestions', 'std.list.map-rule', {
    label: 'Suggestions',
    note: 'Each match as a line the coder reads.',
    config: { rule: 'billing.diagnosis-suggestion', version: 1, item: 'match' }
  });
  g.wire('search.matches', 'suggestions.list');
  const context = joinLists(
    g,
    'context',
    n('What the Coder Reads', 'The suggestions, then the reasons.'),
    'string',
    ['suggestions.text', 'check.rejected']
  );
  g.add('ask', 'std.human.task', {
    label: 'Choose the Diagnosis',
    note: 'A coder picks the diagnosis the claim is billed for.',
    config: {
      title: 'Choose the Diagnosis',
      queue: QUEUE,
      instructions:
        'The report gives no billable diagnosis that can be billed first: the impression and symptoms are missing, not specific enough, or only say how an injury happened. Read the complaint and narrative and choose the ICD-10-CM code that best describes why the patient needed the ambulance. The suggestions come from a search of the complaint or narrative; they are a start, not an answer.',
      fields: [
        {
          name: 'diagnosis',
          type: ICD10,
          label: 'Diagnosis',
          codeSet: 'icd10cm',
          required: ['choose']
        }
      ],
      outcomes: ['choose'],
      hints: { choose: 'Bill this diagnosis first.' }
    }
  });
  g.add('subject', 'encounter.break', { label: 'PCR', note: 'Names the task by its PCR number.' });
  g.wire('entry.encounter', 'subject.encounter');
  g.wire('subject.pcrNumber', 'ask.subject');
  g.wire(context, 'ask.context');
  g.add('rememberChosen', 'std.var.set', {
    label: 'Remember the Diagnosis Chosen',
    note: 'The coder’s code is billed first.',
    config: { name: 'chosen' }
  });
  const chosenList = makeList(
    g,
    'chosenList',
    n('Chosen Diagnosis', 'The coder’s code as a list.'),
    ICD10,
    ['ask.diagnosis']
  );
  g.wire(chosenList, 'rememberChosen.value');
  g.add('chosen', 'std.var.get', {
    label: 'Chosen',
    note: 'The coder’s code, if one was asked for.',
    config: { name: 'chosen' }
  });
  const all = joinLists(
    g,
    'all',
    n('First, Then Causes', 'The coder’s code or the reported ones, then external causes.'),
    ICD10,
    ['chosen.value', `${firsts}.list`, `${causes}.list`]
  );
  node(
    g,
    'once',
    'std.list.unique',
    n('Each Once', 'Leaves out repeated codes.'),
    { list: all },
    { type: ICD10 }
  );
  node(
    g,
    'twelve',
    'std.list.slice',
    n('At Most Twelve', 'A claim takes twelve diagnoses.'),
    { list: 'once.list', start: fixed(0), end: fixed(12) },
    { type: ICD10 }
  );
  node(g, 'rejectedCount', 'std.list.length', n('Rejected Count', 'How many were left out.'), {
    list: 'check.rejected'
  });
  node(g, 'rejectedCodes', 'std.text.join', n('Rejected Codes', 'The codes left out, as text.'), {
    items: 'check.rejected',
    separator: fixed(', ')
  });
  const rejected = select(
    g,
    'rejected',
    n('Rejected Codes Reason', 'Names the codes left out.'),
    'string',
    atLeast(
      g,
      'anyRejected',
      n('Any Rejected', 'At least one code left out.'),
      'integer',
      'rejectedCount.length',
      1
    ),
    template(
      g,
      'rejectedText',
      n('Rejected Codes Text', 'The reason with the codes.'),
      'Left out reported diagnoses that are not billable ICD-10-CM codes: {codes}',
      { codes: 'rejectedCodes.text' }
    )
  );
  g.ret('return', 'coded');
  g.wire('twelve.list', 'return.diagnoses');
  g.wire(
    makeList(g, 'reasons', n('Diagnosis Reasons', 'Which codes were left out.'), 'string', [
      rejected
    ]),
    'return.reasons'
  );
  g.wire('entry.exec', 'check.exec');
  g.wire('check.then', 'hasFirst.exec');
  g.wire('firstFound.result', 'hasFirst.condition');
  g.wire('hasFirst.true', 'return.exec');
  g.wire('hasFirst.false', 'search.exec');
  g.wire('search.then', 'ask.exec');
  g.wire('ask.choose', 'rememberChosen.exec');
  g.wire('rememberChosen.then', 'return.exec');
  return g.def;
};

export const diagnosisGraphs: SeedGraph[] = [
  asRule(
    'billing.external-cause',
    'External Cause',
    'Whether a diagnosis is an external cause code (V00 to Y99), which says how an injury happened and is never billed first.',
    externalCause()
  ),
  asRule(
    'billing.not-external-cause',
    'Not an External Cause',
    'Whether a diagnosis may be billed first: any code but an external cause.',
    notExternalCause()
  ),
  asRule(
    'billing.diagnosis-suggestion',
    'Diagnosis Suggestion',
    'One code Search Diagnoses found, written for a coder to read.',
    suggestion()
  ),
  asStage(
    'billing.code-diagnoses',
    'Code the Diagnoses',
    'Keeps the reported diagnoses that are billable ICD-10-CM codes, with external causes last. When none can be billed first, searches the complaint, else the narrative, and asks a coder to choose the diagnosis, showing the closest codes found; a search is never billed without a coder.',
    codeDiagnoses()
  )
];
