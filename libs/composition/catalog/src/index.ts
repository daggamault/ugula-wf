import { PERMISSIONS } from '@ugula/access';
import { billingEvents, billingKinds, billingModels } from '@ugula/billing';
import {
  createModelNodes,
  createStdNodes,
  type EventDef,
  mergeKinds,
  type NodeDef,
  STD_KINDS,
  type StdDeps
} from '@ugula/graph';
import { nemsisKinds, nemsisModels } from '@ugula/nemsis';

type CatalogDeps = Omit<StdDeps, 'permissions'>;

export const valueKinds = mergeKinds(STD_KINDS, nemsisKinds, billingKinds);

export const workflowEvents: readonly EventDef[] = billingEvents;

export const createNodeCatalog = (std: CatalogDeps): NodeDef[] => [
  ...createStdNodes({ ...std, permissions: PERMISSIONS }),
  ...createModelNodes([...nemsisModels, ...billingModels])
];
