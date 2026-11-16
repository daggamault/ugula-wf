import { INPUT_TYPE, type Json, type NodeInstance } from '@ugula/graph';
import { TableIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import { Badge } from '../../shared/ui/badge.tsx';
import { ButtonLink } from '../../shared/ui/button.tsx';
import { JsonField } from '../../shared/ui/value-field.tsx';
import type { EffectiveTable } from './client.ts';
import { ConfigForm } from './config-form.tsx';
import { ExpressionEditor, ListFormulaEditor } from './expression-editor.tsx';
import {
  CodeSetEditor,
  ConstantEditor,
  GraphInputEditor,
  VariableEditor,
  WorkflowEditor
} from './node-editors.tsx';
import type { SettingsEditorProps } from './settings-editor.ts';
import { DecisionTableEditor, LookupTableEditor } from './table-editors.tsx';
import { RecordFieldsEditor, TaskEditor } from './task-editor.tsx';

export const TABLE_EDITORS = {
  'std.table.lookup': LookupTableEditor,
  'std.table.decide': DecisionTableEditor
} as const;

const LIST_FORMULAS = ['map', 'filter', 'find', 'every', 'some', 'sort-by', 'group-by'];

export const SETTINGS_EDITORS: Readonly<Record<string, ComponentType<SettingsEditorProps>>> = {
  ...TABLE_EDITORS,
  'std.expr': ExpressionEditor,
  ...Object.fromEntries(LIST_FORMULAS.map((key) => [`std.list.${key}`, ListFormulaEditor])),
  'std.human.task': TaskEditor,
  'std.object.make': RecordFieldsEditor,
  'std.object.break': RecordFieldsEditor,
  'std.flow.run-workflow': WorkflowEditor,
  'std.flow.start-workflow': WorkflowEditor,
  'std.flow.map-workflow': WorkflowEditor,
  'std.flow.spawn-workflows': WorkflowEditor,
  'std.value': ConstantEditor,
  'std.convert.to-code': CodeSetEditor,
  'std.var.get': VariableEditor,
  'std.var.set': VariableEditor,
  'std.var.append': VariableEditor,
  'std.var.increment': VariableEditor,
  [INPUT_TYPE]: GraphInputEditor
};

export const NodeSettings = (props: SettingsEditorProps & { node: NodeInstance }) => {
  const { node, catalog } = props;
  const Editor = Object.hasOwn(SETTINGS_EDITORS, node.type)
    ? SETTINGS_EDITORS[node.type]
    : undefined;
  if (Editor) return <Editor {...props} />;
  const schema = catalog.configSchemaOf(node);
  return schema ? (
    <ConfigForm
      id={`${node.id}-settings`}
      schema={schema}
      config={node.config}
      editable={props.editable}
      onConfig={props.onConfig}
    />
  ) : null;
};

export const ConfigEditor = ({
  node,
  editable,
  onConfig
}: {
  node: NodeInstance;
  editable: boolean;
  onConfig: (config: Json | undefined) => void;
}) => (
  <JsonField
    id={`${node.id}-config`}
    label="Settings as JSON"
    disabled={!editable}
    value={node.config ?? null}
    onChange={(config) => onConfig(config ?? undefined)}
  />
);

export const TableReference = ({
  tableKey,
  table
}: {
  tableKey: string;
  table: EffectiveTable | undefined;
}) => (
  <div className="flex flex-col gap-3">
    <p className="text-sm">
      Uses the shared table <code className="font-mono">{tableKey}</code>, so its rules can change
      without changing this workflow.
    </p>
    {table ? (
      <span className="flex flex-wrap items-center gap-2">
        <ButtonLink to={`/tables/${table.id}`} variant="outline">
          <TableIcon aria-hidden="true" className="size-4" />
          Open Table
        </ButtonLink>
        {table.scope === 'system' ? null : (
          <Badge intent="custom">Customized for This Agency</Badge>
        )}
      </span>
    ) : (
      <p className="text-danger text-sm">This table is not available to your agency.</p>
    )}
  </div>
);
