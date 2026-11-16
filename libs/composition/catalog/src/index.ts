import { PERMISSIONS } from '@ugula/access';
import {
  type BillingStores,
  billingKinds,
  billingModels,
  createBillingNodes
} from '@ugula/billing';
import {
  createModelNodes,
  createStdNodes,
  mergeKinds,
  type NodeDef,
  STD_KINDS,
  type StdDeps
} from '@ugula/graph';
import { createNemsisNodes, nemsisKinds, nemsisModels, type ReportStore } from '@ugula/nemsis';

type CatalogDeps = Omit<StdDeps, 'permissions'> & {
  reports?: ReportStore;
  billing?: BillingStores;
};

export const valueKinds = mergeKinds(STD_KINDS, nemsisKinds, billingKinds);

export const createNodeCatalog = ({ reports, billing, ...std }: CatalogDeps): NodeDef[] => [
  ...createStdNodes({ ...std, permissions: PERMISSIONS }),
  ...createNemsisNodes(reports ?? null),
  ...createBillingNodes(billing ?? null),
  ...createModelNodes([...nemsisModels, ...billingModels])
];
