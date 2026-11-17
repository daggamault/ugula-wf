import { PERMISSIONS } from '@ugula/access';
import {
  type BillingStores,
  billingEvents,
  billingKinds,
  billingModels,
  createBillingNodes
} from '@ugula/billing';
import {
  createModelNodes,
  createStdNodes,
  type EventDef,
  mergeKinds,
  type NodeDef,
  STD_KINDS,
  type StdDeps
} from '@ugula/graph';
import {
  createNemsisNodes,
  encounterModels,
  type NemsisStores,
  nemsisEvents,
  nemsisKinds
} from '@ugula/nemsis';

type CatalogDeps = Omit<StdDeps, 'permissions'> & {
  nemsis?: NemsisStores;
  billing?: BillingStores;
};

export const valueKinds = mergeKinds(STD_KINDS, nemsisKinds, billingKinds);

export const workflowEvents: readonly EventDef[] = [...nemsisEvents, ...billingEvents];

export const createNodeCatalog = ({ nemsis, billing, ...std }: CatalogDeps): NodeDef[] => [
  ...createStdNodes({ ...std, permissions: PERMISSIONS }),
  ...createNemsisNodes(nemsis ?? null),
  ...createBillingNodes(billing ?? null),
  ...createModelNodes([...encounterModels, ...billingModels])
];
