import { pin, pureNode } from '@ugula/graph';
import * as v from 'valibot';
import { CLAIM_ISSUE } from '../check-models.ts';
import type { NodesOf } from './stores.ts';

const issueConfig = v.object({
  code: v.pipe(v.string(), v.nonEmpty('Name the issue code')),
  field: v.optional(v.string(), ''),
  message: v.optional(v.string(), '')
});

type IssueConfig = v.InferOutput<typeof issueConfig>;

const ITEM = /{item}/g;

const issueOf = (
  { code, field }: IssueConfig,
  message: string | null,
  coverageId: string | null
) => ({ code, severity: null, field: field || null, message, coverageId });

export const issueNodes: NodesOf = () => [
  pureNode<IssueConfig>({
    type: 'billing.issue-when',
    title: 'Issue When',
    category: 'Billing',
    description:
      'Raises one claim issue, with its code, the field it is fixed in and its message, when the condition wired in holds; otherwise gives nothing. Collect the issues of a check with Make List.',
    level: 'basic',
    keywords: ['issue', 'check', 'problem', 'warning', 'blocking', 'validate'],
    summary: ({ code, message }) => (message ? `${code}: ${message}` : code),
    config: issueConfig,
    inputs: [
      pin('when', 'boolean', { description: 'Raise the issue when this is true.' }),
      pin('message', 'string', {
        optional: true,
        description: 'The message, when it names something from the claim; else the one set here.'
      }),
      pin(
        'coverageId',
        { id: 'coverage' },
        { optional: true, label: 'Payer', description: 'The payer the issue is about, if any.' }
      )
    ],
    outputs: [
      pin('issue', CLAIM_ISSUE.type, {
        description: 'The issue, or nothing when the condition does not hold.'
      })
    ],
    compute: ({ when, message, coverageId }, config) => ({
      issue: when
        ? issueOf(
            config,
            (message as string | null) || config.message || null,
            (coverageId as string | null) ?? null
          )
        : null
    })
  }),
  pureNode<IssueConfig>({
    type: 'billing.issue-for-each',
    title: 'Issue for Each',
    category: 'Billing',
    description:
      'Raises one claim issue for every item of a list, such as each missing part of an address or each unknown diagnosis code; {item} in the message names the item.',
    level: 'basic',
    keywords: ['issue', 'check', 'each', 'every', 'list', 'missing'],
    summary: ({ code, message }) => (message ? `${code}: ${message}` : code),
    config: issueConfig,
    inputs: [
      pin('when', 'boolean', {
        default: true,
        description: 'Raise the issues only when this is true; always when not wired.'
      }),
      pin(
        'items',
        { list: 'string' },
        {
          optional: true,
          description: 'The items to raise an issue for; none when empty.'
        }
      )
    ],
    outputs: [
      pin('issues', { list: CLAIM_ISSUE.type }, { description: 'One issue for each item.' })
    ],
    compute: ({ when, items }, config) => ({
      issues: (when ? ((items ?? []) as (string | null)[]) : []).map((item) =>
        issueOf(config, config.message.replace(ITEM, item ?? ''), null)
      )
    })
  })
];
