import { type BillingStores, billingModels, createBillingNodes } from '@ugula/billing';
import { createModelNodes, createStdNodes, type NodeDef, type StdDeps } from '@ugula/graph';
import { createNemsisNodes, nemsisModels, type ReportStore } from '@ugula/nemsis';

type CatalogDeps = StdDeps & {
  reports?: ReportStore;
  billing?: BillingStores;
};

export const createNodeCatalog = ({ reports, billing, ...std }: CatalogDeps): NodeDef[] => [
  ...createStdNodes(std),
  ...createNemsisNodes(reports ?? null),
  ...createBillingNodes(billing ?? null),
  ...createModelNodes([...nemsisModels, ...billingModels])
];
