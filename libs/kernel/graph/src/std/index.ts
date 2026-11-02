import type { NodeDef } from '../types.ts';
import { convertNodes } from './convert.ts';
import { expressionNodes } from './expression.ts';
import { flowNodes } from './flow.ts';
import { createHttpNodes, type HttpDeps } from './http.ts';
import { humanNodes } from './human.ts';
import { listNodes } from './list.ts';
import { logicNodes } from './logic.ts';
import { mathNodes } from './math.ts';
import { objectNodes } from './object.ts';
import { tableNodes } from './tables.ts';
import { textNodes } from './text.ts';
import { timeNodes } from './time.ts';
import { varNodes } from './vars.ts';

export type StdDeps = HttpDeps;

export const createStdNodes = (deps: StdDeps): NodeDef[] => [
  ...flowNodes,
  ...varNodes,
  ...mathNodes,
  ...expressionNodes,
  ...logicNodes,
  ...textNodes,
  ...listNodes,
  ...objectNodes,
  ...tableNodes,
  ...convertNodes,
  ...timeNodes,
  ...humanNodes,
  ...createHttpNodes(deps)
];
