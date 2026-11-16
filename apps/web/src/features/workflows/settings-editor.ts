import type { GraphDef, Json } from '@ugula/graph';
import type { Catalog } from '../../shared/graph/catalog.ts';

export type SettingsEditorProps = {
  nodeId: string;
  config: Json | undefined;
  editable: boolean;
  onConfig: (config: Json | undefined) => void;
  def: GraphDef;
  catalog: Catalog;
};
