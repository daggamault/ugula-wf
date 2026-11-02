import * as v from 'valibot';
import { pin, pureNode } from '../define.ts';
import { evaluateExpr, exprProblem, freeIdentifiers } from '../expr.ts';
import type { NodeDef, PinSpec } from '../types.ts';

export const validExpressions = <T>(sourcesOf: (input: T) => string[]) =>
  v.check<T, (issue: v.CheckIssue<T>) => string>(
    (input) => sourcesOf(input).every((src) => exprProblem(src) === null),
    (issue) =>
      sourcesOf(issue.input)
        .map(exprProblem)
        .find((p) => p !== null) ?? 'Invalid expression'
  );

export const expressionConfig = v.object({
  expression: v.pipe(
    v.string(),
    v.nonEmpty(),
    validExpressions((src: string) => [src])
  )
});

export type ExpressionConfig = v.InferOutput<typeof expressionConfig>;

const identifiersOf = (src: string) => {
  try {
    return freeIdentifiers(src);
  } catch {
    return [];
  }
};

export const identifierPins = (sources: string[], reserved: readonly string[] = []): PinSpec[] =>
  [...new Set(sources.flatMap(identifiersOf))]
    .filter((name) => !reserved.includes(name))
    .map((name) => pin(name, 'any', { optional: true }));

export const expressionNode = pureNode<ExpressionConfig>({
  type: 'std.expr',
  title: 'Expression',
  category: 'Math',
  description:
    'Evaluates a formula such as `price * qty + tax`; every name in it becomes an input.',
  config: expressionConfig,
  inputs: ({ expression }) => identifierPins([expression]),
  outputs: [pin('result', 'any')],
  compute: (inputs, { expression }, ctx) => ({
    result: evaluateExpr(expression, inputs, { now: ctx.now })
  })
});

export const expressionNodes: NodeDef[] = [expressionNode];
