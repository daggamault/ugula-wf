import { PERMISSIONS } from '@ugula/access';
import { type BillingStores, billingModels, createBillingNodes } from '@ugula/billing';
import { createModelNodes, createStdNodes, type NodeDef, type StdDeps } from '@ugula/graph';
import { createNemsisNodes, nemsisModels, type ReportStore } from '@ugula/nemsis';

type CatalogDeps = Omit<StdDeps, 'permissions'> & {
  reports?: ReportStore;
  billing?: BillingStores;
};

export const createNodeCatalog = ({ reports, billing, ...std }: CatalogDeps): NodeDef[] => [
  ...createStdNodes({ ...std, permissions: PERMISSIONS }),
  ...createNemsisNodes(reports ?? null),
  ...createBillingNodes(billing ?? null),
  ...createModelNodes([...nemsisModels, ...billingModels])
];
